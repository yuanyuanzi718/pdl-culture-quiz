import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function createPublicId(db: Database): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = [...randomBytes(6)].map(b => CHARS[b % CHARS.length]).join('');
    if (!db.prepare('SELECT 1 FROM users WHERE public_id=?').get(code)) return code;
  }
  throw new Error('无法生成用户代号');
}
export function userDisplayName(publicId: string | null): string | null {
  return publicId ? `研习者 ${publicId}` : null;
}
