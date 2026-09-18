import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import getDb from './db/index.js';
import { profileRoutes } from './routes/profile.js';
import { questionRoutes } from './routes/questions.js';
import { examRoutes } from './routes/exam.js';
import { chatRoutes } from './routes/chat.js';
import { vipRoutes } from './routes/vip.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp(logger = false) {
  const app = Fastify({ logger, bodyLimit: 64 * 1024, trustProxy: ['127.0.0.1', '::1', '172.16.0.0/12'] });
  getDb();
  await app.register(cors, { origin: ['http://localhost:5173'], credentials: true });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    // 管理端按来源 IP 计数（防爆破）；业务接口按设备标识计数，避免代理出口 IP 把所有访客挤进同一个桶
    keyGenerator: (request) =>
      request.url.startsWith('/api/admin')
        ? request.ip
        : (request.headers['x-device-id'] as string) || request.ip,
    errorResponseBuilder: (_request, context) => ({
      ok: false,
      error: `操作过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试`,
      code: 'RATE_LIMITED',
      statusCode: 429,
    }),
  });
  await app.register(profileRoutes);
  await app.register(questionRoutes);
  await app.register(examRoutes);
  await app.register(chatRoutes);
  await app.register(vipRoutes);
  await app.register(adminRoutes);
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));
  return app;
}
