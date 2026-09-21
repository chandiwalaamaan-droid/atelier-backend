/**
 * Lists every object in the B2 bucket and diffs it against every
 * avatarUrl/backgroundUrl currently referenced in the DB (User + Character).
 * Anything in the bucket that isn't referenced anywhere is "orphaned" — a
 * replaced avatar, a failed/abandoned upload, an old regenerate-*.ts run,
 * etc. Same category of object the images.ts auth fix now blocks from being
 * served to a prober.
 *
 * Dry-run by default — only prints what it finds. Pass --delete to actually
 * remove the orphaned objects from B2 (irreversible, so read the printed
 * list first).
 *
 * Usage:
 *   npx tsx scripts/find-orphaned-images.mjs
 *   npx tsx scripts/find-orphaned-images.mjs --delete
 *
 * Needs the same env vars as the running server: DATABASE_URL, B2_KEY_ID,
 * B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT.
 */
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

const DELETE = process.argv.includes("--delete");

const prisma = new PrismaClient();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const s3 = new S3Client({
  region: "us-east-005", // B2's S3-compatible region is irrelevant beyond satisfying the SDK
  endpoint: `https://${requireEnv("B2_ENDPOINT")}`,
  credentials: {
    accessKeyId: requireEnv("B2_KEY_ID"),
    secretAccessKey: requireEnv("B2_APPLICATION_KEY"),
  },
});
const BUCKET = requireEnv("B2_BUCKET_NAME");

// Mirrors uploadAvatarBuffer's URL shape in src/lib/b2.ts:
//   `${proxyBase}/api/images/${encodeURIComponent(key)}`
// We only need the "/api/images/<encoded key>" suffix to match against.
function keyFromUrl(url) {
  if (!url) return null;
  const marker = "/api/images/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function listAllBucketKeys() {
  const keys = [];
  let ContinuationToken = undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken })
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key) keys.push({ key: obj.Key, size: obj.Size ?? 0 });
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function referencedKeys() {
  const [users, characters] = await Promise.all([
    prisma.user.findMany({ select: { avatarUrl: true } }),
    prisma.character.findMany({ select: { avatarUrl: true, backgroundUrl: true } }),
  ]);

  const referenced = new Set();
  for (const u of users) {
    const k = keyFromUrl(u.avatarUrl);
    if (k) referenced.add(k);
  }
  for (const c of characters) {
    const k1 = keyFromUrl(c.avatarUrl);
    const k2 = keyFromUrl(c.backgroundUrl);
    if (k1) referenced.add(k1);
    if (k2) referenced.add(k2);
  }
  return referenced;
}

async function main() {
  console.log(`Bucket: ${BUCKET}`);
  console.log(DELETE ? "Mode: DELETE (irreversible)" : "Mode: dry-run (pass --delete to actually remove)");
  console.log("");

  const [bucketObjects, referenced] = await Promise.all([listAllBucketKeys(), referencedKeys()]);

  const orphaned = bucketObjects.filter((o) => !referenced.has(o.key));
  const orphanedBytes = orphaned.reduce((sum, o) => sum + o.size, 0);

  console.log(`Objects in bucket: ${bucketObjects.length}`);
  console.log(`Referenced in DB:  ${referenced.size}`);
  console.log(`Orphaned:          ${orphaned.length} (${(orphanedBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log("");

  if (orphaned.length === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  console.log("Orphaned keys:");
  for (const o of orphaned) {
    console.log(`  ${o.key}  (${(o.size / 1024).toFixed(1)} KB)`);
  }

  if (DELETE) {
    console.log("");
    console.log(`Deleting ${orphaned.length} objects...`);
    // B2/S3 batch-delete accepts up to 1000 keys per request.
    for (let i = 0; i < orphaned.length; i += 1000) {
      const batch = orphaned.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: batch.map((o) => ({ Key: o.key })) },
        })
      );
    }
    console.log("Done.");
  } else {
    console.log("");
    console.log("Dry run only — re-run with --delete to remove these.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
