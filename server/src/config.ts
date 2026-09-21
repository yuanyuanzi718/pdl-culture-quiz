import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const production = process.env.NODE_ENV === 'production';
function secret(name: string): string {
  const value = process.env[name]?.trim();
  const weak = /change[-_ ]?me|pdl-admin|pdl-culture-quiz-2026/i;
  if (!value || weak.test(value)) {
    if (production) throw new Error(`${name} 必须配置独立密钥`);
    return randomBytes(32).toString('hex');
  }
  if (name === 'JWT_SECRET' && value.length < 32) {
    if (production) throw new Error(`${name} 必须配置至少32位的独立随机密钥`);
    return randomBytes(32).toString('hex');
  }
  return value;
}
function integer(name: string, fallback: number, min = 0): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} 配置无效`);
  return value;
}
const price = Number(process.env.VIP_PRICE ?? 9.9);
if (!Number.isFinite(price) || price <= 0) throw new Error('VIP_PRICE 配置无效');
export const config = {
  port: integer('PORT', 3001, 1),
  host: process.env.HOST || '127.0.0.1',
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || '',
  },
  freeQuestionLimit: integer('FREE_QUESTION_LIMIT', 3),
  freeChatLimit: integer('FREE_CHAT_LIMIT', 10),
  chatDailyLimit: integer('CHAT_DAILY_LIMIT', 50, 1),
  vipPrice: price,
  vipCodeValidHours: integer('VIP_CODE_VALID_HOURS', 24, 1),
  jwtSecret: secret('JWT_SECRET'),
  adminToken: secret('ADMIN_TOKEN'),
};
if (production && (!config.deepseek.apiKey || !config.deepseek.model)) {
  throw new Error('生产环境必须配置 DEEPSEEK_API_KEY 和 DEEPSEEK_MODEL');
}
