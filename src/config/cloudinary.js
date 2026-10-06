import { v2 as cloudinary } from 'cloudinary';

// Free tier: 25 credits/month, no credit card required.
// 1 credit = 1GB storage OR 1GB bandwidth — plenty for audio receipts + recordings.
// Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// (dashboard: https://console.cloudinary.com/settings/api-keys)
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

export const isCloudinaryEnabled = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
);

if (isCloudinaryEnabled) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export const cloudinaryFolderPrefix =
  process.env.CLOUDINARY_FOLDER || 'quran-platform';

/**
 * Upload a memory buffer to Cloudinary.
 * resource_type 'auto' routes audio->video, images->image, pdf->raw automatically.
 * Returns the permanent HTTPS delivery URL (stored in MongoDB as today).
 */
export const uploadBufferToCloudinary = (buffer, { folder, filename } = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder || cloudinaryFolderPrefix,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
        filename_override: filename,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });

/**
 * Delete one asset from Cloudinary (used by the storage-cleanup job).
 * resourceType must match how it was stored ('video' for audio, 'image', 'raw').
 * Returns true when deleted (or already gone), false on failure.
 */
export const deleteFromCloudinary = async (publicId, resourceType) => {
  if (!isCloudinaryEnabled || !publicId) return false;
  // destroy() accepts only image|video|raw — never 'auto'
  const type = ['image', 'video', 'raw'].includes(resourceType) ? resourceType : 'image';
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: type,
      invalidate: true,
    });
    return true;
  } catch (err) {
    // "not found" means already gone — treat as success so DB stays consistent
    if (err?.error?.http_code === 404 || /not found/i.test(err?.message || '')) {
      return true;
    }
    console.error('Cloudinary delete error:', err?.message || err);
    return false;
  }
};

export default cloudinary;
