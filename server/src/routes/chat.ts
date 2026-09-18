// 对话答疑路由：RAG + DeepSeek
import type { FastifyInstance } from 'fastify';
import getDb from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { retrieve } from '../services/rag.js';
import { chatCompletion } from '../services/deepseek.js';
import type { ChatPayload } from '../types.js';

const inFlight = new Set<number>();

// 判断对话是否锁定（独立于刷题额度）
function isChatLocked(userId: number): boolean {
  const db = getDb();
  const u = db
    .prepare('SELECT chat_free_used_count, vip_activated_at FROM users WHERE id = ?')
    .get(userId) as
    | { chat_free_used_count: number; vip_activated_at: number | null }
    | undefined;
  if (!u) return true;
  return u.chat_free_used_count >= config.freeChatLimit && u.vip_activated_at === null;
}

// 今日已用对话次数（所有用户统一上限，保护 API 费用；页面不展示，达到才提示）
function todayChatCount(userId: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM chat_logs WHERE user_id = ? AND role = 'user' AND kind = 'chat' AND created_at >= ?")
    .get(userId, start.getTime()) as { n: number };
  return row.n;
}

// 预设问答：匹配关键词直接返回固定答案，不调 DeepSeek、不计费（作为引导）
const PRESET_QA: Array<{ match: RegExp; answer: string }> = [
  {
    match: /^胖东来简介[？?]?$/,
    answer:
      '胖东来商贸集团有限公司是一家以线下实体门店为主的综合性零售企业，创建于1995年3月，发展至今在许昌、新乡两地共14家门店，其中包含6家综合型百货商场、13家超市、1家服饰鞋业类专业门店；配套1家中央厨房、2家物流中心。经营业态涵盖超市、百货、电器、服饰、餐饮、医药、珠宝、茶叶、电影、电玩等。目前用工总人数约1万人，安排就业人数（含厂家代表等）约2万人。',
  },
];

function matchPreset(message: string): string | null {
  const trimmed = message.trim();
  for (const qa of PRESET_QA) {
    if (qa.match.test(trimmed)) return qa.answer;
  }
  return null;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/chat/history', { preHandler: requireAuth }, async (request) => {
    const messages = getDb().prepare('SELECT role, content, references_json FROM (SELECT id, role, content, references_json FROM chat_logs WHERE user_id = ? ORDER BY id DESC LIMIT 40) ORDER BY id').all(request.user!.userId) as Array<{ role: string; content: string; references_json: string | null }>;
    return { ok: true, data: { messages: messages.map((m) => ({ role: m.role, content: m.content, references: m.references_json ? JSON.parse(m.references_json) : [] })) } };
  });
  // 对话答疑
  app.post('/api/chat', { preHandler: requireAuth }, async (request, reply) => {
    const body = (request.body ?? {}) as Partial<ChatPayload>;
    const userId = body.userId;
    const message = body.message;
    if (!userId || userId !== request.user!.userId) {
      return reply.code(403).send({ ok: false, error: '无权代他人提问' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.code(400).send({ ok: false, error: '消息内容不能为空' });
    }

    if (isChatLocked(userId)) {
      return reply
        .code(403)
        .send({ ok: false, error: '免费对话额度已用完，请激活 VIP 后继续' });
    }

    if (todayChatCount(userId) >= config.chatDailyLimit) {
      return reply
        .code(429)
        .send({ ok: false, error: '今日对话次数已达上限，请明天再来', code: 'DAILY_LIMIT' });
    }

    if (message.length > 6000) return reply.code(400).send({ ok: false, error: '消息不能超过6000字' });
    if (inFlight.has(userId)) return reply.code(409).send({ ok: false, error: '上一条问题正在处理，请稍候' });

    // 预设问答：匹配则直接返回固定答案，不调 DeepSeek、不计费
    const presetAnswer = matchPreset(message);
    if (presetAnswer) {
      const db = getDb();
      const now = Date.now();
      const insertLog = db.prepare(
        `INSERT INTO chat_logs (user_id, role, content, created_at, references_json, kind) VALUES (@userId, @role, @content, @createdAt, @references, 'preset')`
      );
      db.transaction(() => {
        insertLog.run({ userId, role: 'user', content: message, createdAt: now, references: null });
        insertLog.run({ userId, role: 'assistant', content: presetAnswer, createdAt: now + 1, references: JSON.stringify([]) });
      })();
      const after = db
        .prepare('SELECT chat_free_used_count, vip_activated_at FROM users WHERE id = ?')
        .get(userId) as
        | { chat_free_used_count: number; vip_activated_at: number | null }
        | undefined;
      const remaining = after
        ? after.vip_activated_at === null
          ? Math.max(0, config.freeChatLimit - after.chat_free_used_count)
          : -1
        : 0;
      return reply.send({
        ok: true,
        data: { reply: presetAnswer, references: [], chatRemaining: remaining },
      });
    }

    if (!config.deepseek.apiKey || !config.deepseek.model) return reply.code(503).send({ ok: false, error: 'AI 服务尚未配置，请联系管理员' });
    // RAG 检索
    const { snippets, prompt } = retrieve(message);

    const history = getDb().prepare('SELECT role, content FROM (SELECT id, role, content FROM chat_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10) ORDER BY id').all(userId) as Array<{ role: 'user' | 'assistant'; content: string }>;
    inFlight.add(userId);
    // 调用 DeepSeek
    let replyText: string;
    try {
      const result = await chatCompletion(message, prompt, history);
      replyText = result.content;
    } catch (e) {
      request.log.error({ err: (e as Error).message }, 'DeepSeek 调用失败');
      return reply.code(502).send({ ok: false, error: 'AI 服务暂时不可用，请稍后再试' });
    } finally {
      inFlight.delete(userId);
    }

    // 写入聊天日志
    const db = getDb();
    const now = Date.now();
    const insertLog = db.prepare(
      `INSERT INTO chat_logs (user_id, role, content, created_at, references_json) VALUES (@userId, @role, @content, @createdAt, @references)`
    );
    db.transaction(() => {
    insertLog.run({ userId, role: 'user', content: message, createdAt: now, references: null });
    insertLog.run({ userId, role: 'assistant', content: replyText, createdAt: now + 1, references: JSON.stringify(snippets) });

    // 累加对话免费额度（VIP 用户不累加）
    const u = db.prepare('SELECT vip_activated_at FROM users WHERE id = ?').get(userId) as
      | { vip_activated_at: number | null }
      | undefined;
    if (u && u.vip_activated_at === null) {
      db.prepare('UPDATE users SET chat_free_used_count = chat_free_used_count + 1 WHERE id = ?').run(
        userId
      );
    }

    })();

    // 返回剩余额度，便于前端即时显示
    const after = db
      .prepare('SELECT chat_free_used_count, vip_activated_at FROM users WHERE id = ?')
      .get(userId) as
      | { chat_free_used_count: number; vip_activated_at: number | null }
      | undefined;
    const remaining = after
      ? after.vip_activated_at === null
        ? Math.max(0, config.freeChatLimit - after.chat_free_used_count)
        : -1 // VIP 用户标记无限
      : 0;

    return reply.send({
      ok: true,
      data: {
        reply: replyText,
        references: snippets,
        chatRemaining: remaining,
      },
    });
  });
}
