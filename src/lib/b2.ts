import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Backblaze B2 — S3-compatible object storage, used here in place of
// Cloudflare R2. B2 has no policy against AI-generated adult content
// (unlike Cloudinary, which is why this codebase moved off it originally),
// and its free tier (10 GB storage + 1 GB/day free egress, no credit card)
// covers this app's avatar/background hosting comfortably.
//
// Setup (Backblaze dashboard -> B2 Cloud Storage):
//   1. Create a bucket (e.g. "atelier-images-vsp2026"). Note its "Endpoint"
//      value shown on the bucket page, e.g. s3.us-east-005.backblazeb2.com —
//      that region code (us-east-005) varies per account, so copy it exactly
//      rather than assuming a value.
//   2. Bucket must be set to "Public" (Bucket Settings -> Files in Bucket are
//      "Public") for uploaded images to be viewable via a plain URL the way
//      this app expects — same as enabling R2's public access toggle.
//   3. Application Keys -> Add a New Application Key, scoped to just this
//      bucket, with Read and Write capabilities. This gives you a keyID
//      (goes in B2_KEY_ID) and a secret application key (goes in
//      B2_APPLICATION_KEY, shown only once — save it immediately).
//
// B2_ENDPOINT is the full https:// endpoint from step 1 (region-specific,
// no bucket name in it). B2_PUBLIC_URL is what browsers hit to view a file;
// if left unset it's derived from B2_ENDPOINT + B2_BUCKET_NAME using B2's
// virtual-hosted-style URL (https://<bucket>.<endpoint-host>/<key>), but you
// can override it with a custom domain later the same way R2_PUBLIC_URL
// worked.

let client: S3Client | null = null;
let configError: Error | null = null;

function getClient(): S3Client {
  if (client) return client;
  if (configError) throw configError;

  const endpoint = process.env.B2_ENDPOINT;
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    configError = new Error(
      "B2 not configured: B2_ENDPOINT, B2_KEY_ID, and B2_APPLICATION_KEY must all be set."
    );
    throw configError;
  }

  client = new S3Client({
    // B2's S3-compatible API is region-locked to whatever's baked into the
    // endpoint host (e.g. us-east-005) — "auto" (which works for R2) is
    // rejected by B2, so the region is parsed out of the endpoint instead.
    region: parseRegionFromEndpoint(endpoint),
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // B2's S3 gateway does not support the newer AWS "SigV4 payload hashing
    // via stream" flow the SDK defaults to for Node 18+; forcing classic
    // path-style + computed content length avoids intermittent
    // "InvalidArgument: ContentLength" errors that otherwise show up when
    // multer buffers are piped straight through PutObjectCommand.
    forcePathStyle: true,
  });
  return client;
}

// e.g. "https://s3.us-east-005.backblazeb2.com" -> "us-east-005"
function parseRegionFromEndpoint(endpoint: string): string {
  const match = endpoint.match(/^https?:\/\/s3\.([^.]+)\.backblazeb2\.com/i);
  if (!match) {
    throw new Error(
      `B2_ENDPOINT "${endpoint}" doesn't look like a Backblaze S3 endpoint ` +
        `(expected something like https://s3.us-east-005.backblazeb2.com)`
    );
  }
  return match[1];
}

function derivedPublicUrl(): string {
  const endpoint = process.env.B2_ENDPOINT!;
  const bucket = process.env.B2_BUCKET_NAME!;
  const host = endpoint.replace(/^https?:\/\//, "");
  // forcePathStyle above is for the SDK's PUT calls; the public read URL
  // B2 actually serves on is virtual-hosted-style (bucket as a subdomain).
  return `https://${bucket}.${host}`;
}

/**
 * Uploads image bytes to Backblaze B2 and returns a public URL — same
 * signature as the old uploadAvatarBuffer() in lib/r2.ts, so every call
 * site in src/routes/avatar.ts works unchanged aside from the import path.
 *
 * publicId is used as the object key, prefixed the same way the R2/Cloudinary
 * versions were ("atelier/avatars/...") so existing publicId values
 * generated elsewhere in the codebase don't need to change.
 */
export async function uploadAvatarBuffer(buffer: Buffer, publicId: string): Promise<string> {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) throw new Error("B2_BUCKET_NAME not set");
  const publicUrl = (process.env.B2_PUBLIC_URL || derivedPublicUrl()).replace(/\/$/, "");

  // Sniff a few common image formats from the buffer's magic bytes so we
  // send a correct Content-Type without needing the caller to pass one.
  let contentType = "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    contentType = "image/jpeg";
  } else if (
    buffer.length >= 4 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    contentType = "image/webp";
  } else if (buffer.length >= 6 && buffer.toString("ascii", 0, 6).match(/^GIF8[79]a$/)) {
    contentType = "image/gif";
  }
  // Default (image/png) already covers PNG's magic bytes case — sharp's
  // resize/convert steps elsewhere in this codebase normalize most output
  // to PNG or JPEG before this function is ever called.

  const key = `atelier/avatars/${publicId}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
      // The bucket itself must be set to "Public" in Backblaze's dashboard
      // (see setup notes above) — B2's S3 gateway ignores per-object ACL
      // params like Cloudflare R2 does, so there's nothing to set here.
    })
  );

  return `${publicUrl}/${key}`;
}
