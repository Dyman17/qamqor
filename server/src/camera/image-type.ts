export const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB (assumption, tune to the real camera)

export type ImageType = { ext: 'jpg' | 'png'; mime: 'image/jpeg' | 'image/png' };

/** Detects JPEG / PNG by magic bytes. The client-supplied name and Content-Type are never trusted. */
export function detectImageType(buf: Buffer | undefined): ImageType | null {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  return null;
}

/** Decodes a base64 / data-URI image with a size cap; returns null when it is not valid. */
export function decodeBase64Image(input: string | undefined): Buffer | null {
  if (!input) return null;
  const clean = input.replace(/^data:image\/(png|jpeg|jpg);base64,/i, '');
  if (clean.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  const buf = Buffer.from(clean, 'base64');
  return buf.length > 0 && buf.length <= MAX_IMAGE_BYTES ? buf : null;
}
