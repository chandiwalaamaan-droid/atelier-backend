"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCloudinary = getCloudinary;
exports.uploadAvatarBuffer = uploadAvatarBuffer;
const cloudinary_1 = require("cloudinary");
// Avatars (uploaded or AI-generated) are stored on Cloudinary's free tier
// instead of local disk. This matters specifically on Render's free plan,
// which does not support persistent disks — anything written to local disk
// is wiped on every restart/redeploy. Cloudinary URLs are permanent
// regardless of how often the backend restarts.
//
// Free account: cloudinary.com — no credit card. Get these three values from
// the dashboard home page after signup.
let configured = false;
let configError = null;
function getCloudinary() {
    if (configured)
        return cloudinary_1.v2;
    if (configError)
        throw configError;
    try {
        cloudinary_1.v2.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
            secure: true,
        });
        configured = true;
        return cloudinary_1.v2;
    }
    catch (err) {
        configError = err instanceof Error ? err : new Error(String(err));
        throw configError;
    }
}
function uploadAvatarBuffer(buffer, publicId) {
    return new Promise((resolve, reject) => {
        getCloudinary()
            .uploader.upload_stream({
            folder: "atelier/avatars",
            public_id: publicId,
            resource_type: "image",
            overwrite: true,
        }, (err, result) => {
            if (err || !result)
                return reject(err ?? new Error("Cloudinary upload returned no result"));
            resolve(result.secure_url);
        })
            .end(buffer);
    });
}
