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
  const app = Fastify({ logger, bodyLimit: 64 * 1024, trustProxy: ['127.0.0.1', '::1'] });
  getDb();
  await app.register(cors, { origin: ['http://localhost:5173'], credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(profileRoutes);
  await app.register(questionRoutes);
  await app.register(examRoutes);
  await app.register(chatRoutes);
  await app.register(vipRoutes);
  await app.register(adminRoutes);
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));
  return app;
}
