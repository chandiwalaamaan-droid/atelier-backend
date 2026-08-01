import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { asyncHandler } from "../lib/asyncHandler";
import { getClient, getBucketName } from "../lib/b2";

// GET /api/images/:key(*) — streams an object straight out of the private
// B2 bucket. This is what lets the bucket stay PRIVATE (no card-on-file
// needed for B2's first-public-bucket verification) while avatar/scene/
// background URLs still just work as plain <img src> URLs for the frontend.
//
// The key is url-encoded on write (see uploadAvatarBuffer in ../lib/b2) and
// contains slashes ("atelier/avatars/xyz.png"), so we use a wildcard param
// and decode it ourselves rather than relying on a single :key segment.
const router = Router();

router.get(
  "/:key(*)",
  asyncHandler(async (req, res) => {
    const key = decodeURIComponent(req.params.key);

    let object;
    try {
      object = await getClient().send(
        new GetObjectCommand({ Bucket: getBucketName(), Key: key })
      );
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: "Image not found." });
      }
      throw err;
    }

    if (!object.Body) {
      return res.status(404).json({ error: "Image not found." });
    }

    const contentLength = object.ContentLength ?? undefined;
    res.set({
      "Content-Type": object.ContentType || "image/png",
      ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    const bodyStream = object.Body as NodeJS.ReadableStream;
    bodyStream.on("error", (err: Error) => {
      console.error("[images] stream error:", err);
      if (!res.headersSent) {
        res.status(502).json({ error: "Failed to stream image." });
      }
    });

    bodyStream.pipe(res);
  })
);

export default router;
