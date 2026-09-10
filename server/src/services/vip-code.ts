// VIP 码生成（8 位大写字母+数字，去除易混淆字符 O/0/I/1/L）
import { randomBytes } from 'node:crypto';
import getDb from '../db/index.js';
import type { VipCode } from '../types.js';

// 可用字符集：去除 O / 0 / I / 1 / L
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

// 生成一个 8 位 VIP 码（加密安全随机）
export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARS[bytes[i] % CHARS.length];
  }
  return code;
}

// 生成唯一 VIP 码并写入数据库（status='available'），重试碰撞
export function createVipCode(): string {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO vip_codes (code, status, created_at) VALUES (@code, 'available', @createdAt)`
  );

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      insert.run({ code, createdAt: Date.now() });
      return code;
    } catch (e) {
      // 碰撞则重试
      continue;
    }
  }
  throw new Error('VIP 码生成失败：多次碰撞');
}

// 标记 VIP 码为已发送（关联 user / order）
export function markCodeSent(code: string, userId: number, orderId: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE vip_codes SET status='sent', user_id=@userId, order_id=@orderId, sent_at=@sentAt WHERE code=@code`
  ).run({ code, userId, orderId, sentAt: Date.now() });
}

// 按 code 查询 VIP 码记录
export function findVipCode(code: string): VipCode | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM vip_codes WHERE code = ?').get(code) as VipCode | undefined;
  return row ?? null;
}

// 激活 VIP 码：标记 used + 写 activated_at + 绑定设备
export function activateCode(code: string, userId: number, deviceId: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `UPDATE vip_codes SET status='used', user_id=@userId, device_id=@deviceId, activated_at=@now WHERE code=@code`
  ).run({ code, userId, deviceId, now });
}

// 解绑 VIP 码：状态改回 sent，清空设备/激活时间，释放给其他设备使用
export function unbindCode(code: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE vip_codes SET status='sent', user_id=NULL, device_id=NULL, activated_at=NULL, sent_at=@sentAt WHERE code=@code`
  ).run({ code, sentAt: Date.now() });
}
