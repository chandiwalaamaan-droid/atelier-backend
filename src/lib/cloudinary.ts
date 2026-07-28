// This file was originally a Cloudinary uploader. Cloudinary flagged this
// app's AI-generated adult content under its Acceptable Use Policy, so
// all image storage was migrated to Backblaze B2 (see ./b2.ts).
//
// This file is kept as a stub so the TypeScript build still succeeds for
// anyone who has it checked out. The actual upload logic lives in ./b2.ts.
//
// If nothing in src/ imports from this file anymore, feel free to delete it.
export { uploadAvatarBuffer } from "./b2";
export { uploadAvatarBuffer as uploadToCloudinary } from "./b2";