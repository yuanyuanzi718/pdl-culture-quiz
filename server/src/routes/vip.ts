// VIP 激活 / 解绑路由
import type { FastifyInstance } from 'fastify';
import getDb from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { findVipCode, activateCode, unbindCode } from '../services/vip-code.js';
import type { User, VipActivatePayload } from '../types.js';

// 用户行结构
interface UserRow {
  id: number;
  phone: string;
  device_id: string | null;
  vip_activated_at: number | null;
  vip_code: string | null;
  free_used_count: number;
  chat_free_used_count: number;
  created_at: number;
}

// 是否已锁定（免费答题次数用完且未激活 VIP）
function isLocked(user: { free_used_count: number; vip_activated_at: number | null }): boolean {
  return user.free_used_count >= config.freeExamLimit && user.vip_activated_at === null;
}

function isChatLocked(user: {
  chat_free_used_count: number;
  vip_activated_at: number | null;
}): boolean {
  return user.chat_free_used_count >= config.freeChatLimit && user.vip_activated_at === null;
}

// 驼峰命名转换
function toUser(row: UserRow): User {
  return {
    id: row.id,
    deviceId: row.device_id,
    vipActivatedAt: row.vip_activated_at,
    vipCode: row.vip_code,
    freeUsedCount: row.free_used_count,
    chatFreeUsedCount: row.chat_free_used_count,
    isLocked: isLocked(row),
    isChatLocked: isChatLocked(row),
    freeExamLimit: config.freeExamLimit,
    examQuestionsPerRound: config.examQuestionsPerRound,
    chatFreeLimit: config.freeChatLimit,
    createdAt: row.created_at,
  };
}

export async function vipRoutes(app: FastifyInstance): Promise<void> {
  // VIP 码激活（绑定设备）
  app.post('/api/vip/activate', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = (request.body ?? {}) as Partial<VipActivatePayload>;
    const userId = typeof body.userId === 'number' ? body.userId : null;
    const code = body.code;
    const deviceId = body.deviceId;

    if (!userId || userId !== request.user!.userId) {
      return reply.code(403).send({ ok: false, error: '无权为他人激活' });
    }
    if (!code || typeof code !== 'string') {
      return reply.code(400).send({ ok: false, error: 'VIP 码不能为空' });
    }
    if (!deviceId || typeof deviceId !== 'string') {
      return reply.code(400).send({ ok: false, error: '缺少设备标识' });
    }

    const db = getDb();
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!current || current.device_id !== deviceId) {
      return reply.code(403).send({ ok: false, error: '设备标识与当前用户不一致' });
    }
    if (current.vip_activated_at && current.vip_code !== code.trim().toUpperCase()) {
      return reply.code(409).send({ ok: false, error: '当前已激活 VIP，请先解绑后再更换激活码' });
    }
    const record = findVipCode(code.trim().toUpperCase());
    if (!record) {
      return reply.code(404).send({ ok: false, error: 'VIP 码不存在' });
    }
    if (record.status !== 'sent') {
      // 已激活：判断是否同一设备
      if (record.status === 'used') {
        if (record.device_id === deviceId && record.user_id === userId) {
          // 同设备重复激活：直接返回当前用户信息
          const db = getDb();
          const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
          return reply.send({ ok: true, data: { user: toUser(user), activated: true } });
        }
        return reply
          .code(400)
          .send({ ok: false, error: '该激活码已在其他设备激活，请先在原设备解绑' });
      }
      return reply.code(400).send({ ok: false, error: 'VIP 码状态不可用（未发放）' });
    }

    if (record.user_id !== null && record.user_id !== userId) return reply.code(403).send({ ok: false, error: '该激活码已发放给其他用户' });

    // 校验是否过期：仅限从未激活过的发放码；已激活（已付费）的码解绑后不再过期
    if (!record.activated_at) {
      const expiredAt = (record.sent_at ?? record.created_at) + config.vipCodeValidHours * 3600 * 1000;
      if (Date.now() > expiredAt) {
        return reply.code(400).send({ ok: false, error: 'VIP 码已过期' });
      }
    }

    // 事务：标记码 used + 绑定设备 + 激活用户
    const activate = db.transaction(() => {
      activateCode(record.code, userId, deviceId);
      db.prepare(
        'UPDATE users SET vip_activated_at = ?, vip_code = ?, device_id = ? WHERE id = ?'
      ).run(Date.now(), record.code, deviceId, userId);
    });
    activate();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;

    return reply.send({ ok: true, data: { user: toUser(user), activated: true } });
  });

  // 解绑 VIP（释放激活码，可在其他设备重新激活）
  app.post('/api/vip/unbind', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = request.user!.userId;
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!user || !user.vip_code || !user.vip_activated_at) {
      return reply.code(400).send({ ok: false, error: '当前未激活 VIP' });
    }

    const unbind = db.transaction(() => {
      unbindCode(user.vip_code!);
      db.prepare('UPDATE users SET vip_activated_at = NULL, vip_code = NULL WHERE id = ?').run(
        userId
      );
    });
    unbind();

    const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    return reply.send({ ok: true, data: { user: toUser(refreshed) } });
  });
}
