/**
 * Client-side image compression utility.
 * Resizes and compresses images using Canvas API before upload.
 * Reduces disk usage and upload bandwidth without server-side processing.
 */

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.8;
const MIN_FILE_SIZE_KB = 150; // skip compression for files already small enough

/**
 * Compress a single image File. Returns a new File with the compressed image.
 * Non-image files are returned unchanged.
 * Files already under MIN_FILE_SIZE_KB are returned unchanged.
 */
export async function compressImage(file: File): Promise<File> {
  // Only compress image files
  if (!file.type.startsWith('image/')) return file;

  // Skip small files — already efficient
  if (file.size < MIN_FILE_SIZE_KB * 1024) return file;

  // Skip HEIC — browsers can't reliably decode HEIC via Canvas
  if (file.type === 'image/heic' || file.type === 'image/heif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = calculateDimensions(bitmap.width, bitmap.height);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    bitmap.close();

    // Only use compressed version if it's actually smaller
    if (blob.size >= file.size) return file;

    // Preserve original filename but change extension to .jpg
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    // If compression fails (e.g., browser doesn't support createImageBitmap),
    // return the original file — upload will still work
    return file;
  }
}

/**
 * Compress multiple image files in parallel.
 * Returns array of Files (compressed where applicable, original otherwise).
 */
export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f)));
}

/** Calculate scaled dimensions maintaining aspect ratio. */
function calculateDimensions(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return { width, height };
  }
  if (width >= height) {
    return {
      width: MAX_DIMENSION,
      height: Math.round((height / width) * MAX_DIMENSION),
    };
  }
  return {
    width: Math.round((width / height) * MAX_DIMENSION),
    height: MAX_DIMENSION,
  };
}