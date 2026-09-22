// 用户资料路由：游客登录（基于设备）+ 查询个人资料
import type { FastifyInstance } from 'fastify';
import getDb from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import type { User } from '../types.js';

// 用户行结构
interface UserRow {
  id: number;
  phone: string | null;
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

// 对话是否已锁定（独立额度）
function isChatLocked(user: {
  chat_free_used_count: number;
  vip_activated_at: number | null;
}): boolean {
  return user.chat_free_used_count >= config.freeChatLimit && user.vip_activated_at === null;
}

// 将数据库行转为驼峰命名的前端 User 对象
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

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // 游客登录：基于 device_id 复用或创建用户，无需手机号
  // 同一设备再次打开会拿到同一个用户（保留免费额度、VIP 状态等）
  app.post('/api/profile/guest', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { deviceId } = (request.body ?? {}) as { deviceId?: string };
    if (!deviceId || typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{20,128}$/.test(deviceId)) {
      return reply.code(400).send({ ok: false, error: '缺少设备标识 deviceId' });
    }

    const db = getDb();
    // 同设备复用已有用户
    let user = db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId) as
      | UserRow
      | undefined;

    if (!user) {
      const insert = db.prepare(
        `INSERT INTO users (phone, device_id, free_used_count, created_at) VALUES (?, ?, 0, ?)`
      );
      const info = insert.run(null, deviceId, Date.now());
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid)) as
        | UserRow
        | undefined;
    }

    if (!user) {
      return reply.code(500).send({ ok: false, error: '游客创建失败' });
    }

    const token = await signToken(user.id, user.phone);
    return reply.send({ ok: true, data: { user: toUser(user), token } });
  });

  // 查询个人资料（需 JWT，只能查自己）
  app.get('/api/profile/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number((request.params as { userId: string }).userId);
    const authUser = request.user!;
    if (authUser.userId !== userId) {
      return reply.code(403).send({ ok: false, error: '无权访问他人资料' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!user) {
      return reply.code(404).send({ ok: false, error: '用户不存在' });
    }

    return reply.send({ ok: true, data: toUser(user) });
  });
}
