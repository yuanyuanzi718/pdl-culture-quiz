export const MAX_IMAGE_BYTES = 1024 * 1024;

// 只接收内嵌图片，避免服务器下载外部 URL。校验声明类型与文件签名。
export function validateChatImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_BYTES * 1.4 + 100) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (match[1] === 'png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
}
