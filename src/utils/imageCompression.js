import imageCompression from 'browser-image-compression';

/**
 * Compresses an image File for municipal evidence uploads.
 * Targets <= 300KB WebP with max 1280px dimension while preserving usable visual quality.
 * Gracefully falls back to the original File if compression fails.
 *
 * @param {File} file - Original user-selected file (JPEG, PNG, WebP)
 * @param {Object} [customOptions] - Optional overrides for compression
 * @returns {Promise<File>} Compressed File or original File on fallback
 */
export async function compressIncidentPhoto(file, customOptions = {}) {
  if (!file || !(file instanceof Blob)) {
    return file;
  }

  // Only attempt compression on supported image MIME types
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!supportedTypes.includes(file.type)) {
    return file;
  }

  // If already under 200KB, return as-is to save CPU/battery
  if (file.size <= 200 * 1024) {
    return file;
  }

  const options = {
    maxSizeMB: 0.3, // Target ~300 KB
    maxWidthOrHeight: 1280,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.82,
    ...customOptions,
  };

  try {
    const compressedBlob = await imageCompression(file, options);

    // Derive a clean filename with .webp extension if converted
    const originalNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    const extension = compressedBlob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'jpg');
    const newFileName = `${originalNameWithoutExt}.${extension}`;

    const compressedFile = new File([compressedBlob], newFileName, {
      type: compressedBlob.type || 'image/webp',
      lastModified: Date.now(),
    });

    return compressedFile;
  } catch (primaryErr) {
    console.warn('Web worker image compression failed, attempting main-thread fallback:', primaryErr);

    try {
      // Fallback without web worker in case worker script fails in some environments
      const fallbackBlob = await imageCompression(file, {
        ...options,
        useWebWorker: false,
      });

      const originalNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      const extension = fallbackBlob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'jpg');
      const newFileName = `${originalNameWithoutExt}.${extension}`;

      return new File([fallbackBlob], newFileName, {
        type: fallbackBlob.type || 'image/webp',
        lastModified: Date.now(),
      });
    } catch (fallbackErr) {
      console.warn('Image compression fallback failed, using original file:', fallbackErr);
      return file;
    }
  }
}
