import { v2 as cloudinary } from "cloudinary";

// Avatars (uploaded or AI-generated) are stored on Cloudinary's free tier
// instead of local disk. This matters specifically on Render's free plan,
// which does not support persistent disks — anything written to local disk
// is wiped on every restart/redeploy. Cloudinary URLs are permanent
// regardless of how often the backend restarts.
//
// Free account: cloudinary.com — no credit card. Get these three values from
// the dashboard home page after signup.
let configured = false;

export function getCloudinary() {
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

export function uploadAvatarBuffer(buffer: Buffer, publicId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    getCloudinary()
      .uploader.upload_stream(
        {
          folder: "atelier/avatars",
          public_id: publicId,
          resource_type: "image",
          overwrite: true,
        },
        (err, result) => {
          if (err || !result) return reject(err ?? new Error("Cloudinary upload returned no result"));
          resolve(result.secure_url);
        }
      )
      .end(buffer);
  });
}
