// 管理后台令牌认证（preHandler 中间件）
import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// 校验请求头 x-admin-token，不匹配则返回 401
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.headers['x-admin-token'];
  if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(config.adminToken) || !timingSafeEqual(Buffer.from(token), Buffer.from(config.adminToken))) {
    reply.code(401).send({ ok: false, error: '管理员令牌无效' });
    return;
  }
}
