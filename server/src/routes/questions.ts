// 题目路由：随机抽题
import type { FastifyInstance } from 'fastify';
import getDb from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import type { Question } from '../types.js';

// 题库行结构
interface QuestionRow {
  id: number;
  type: string;
  stem: string;
  options: string;
  answer: string;
  explanation: string | null;
  source: string | null;
  tags: string | null;
}

// 每次考试的固定题型配比：4 单选 + 4 判断 + 2 多选，顺序固定
const EXAM_PLAN: Array<{ type: 'single' | 'judge' | 'multi'; count: number }> = [
  { type: 'single', count: 4 },
  { type: 'judge', count: 4 },
  { type: 'multi', count: 2 },
];

// 判断用户是否锁定
function userLocked(userId: number): boolean {
  const db = getDb();
  const u = db.prepare('SELECT free_used_count, vip_activated_at FROM users WHERE id = ?').get(userId) as
    | { free_used_count: number; vip_activated_at: number | null }
    | undefined;
  if (!u) return true;
  return u.free_used_count >= config.freeQuestionLimit && u.vip_activated_at === null;
}

// 收集用户历史做过的题目 id
function pastQuestionIds(userId: number): Set<number> {
  const db = getDb();
  const rows = db
    .prepare('SELECT question_ids FROM exam_records WHERE user_id = ?')
    .all(userId) as Array<{ question_ids: string }>;
  const set = new Set<number>();
  for (const r of rows) {
    try {
      const ids = JSON.parse(r.question_ids) as number[];
      for (const id of ids) set.add(id);
    } catch {
      continue;
    }
  }
  return set;
}

// 从指定题型中随机抽 n 题，优先未做过的；未做过的不足时从已做过的补足
function pickByType(
  db: ReturnType<typeof getDb>,
  type: string,
  n: number,
  excludeIds: Set<number>
): QuestionRow[] {
  const all = db
    .prepare('SELECT * FROM questions WHERE type = ? ORDER BY RANDOM()')
    .all(type) as QuestionRow[];
  const fresh = all.filter((r) => !excludeIds.has(r.id));
  const used = all.filter((r) => excludeIds.has(r.id));
  // 优先未做过的，不足时用已做过的补足
  const picked = fresh.slice(0, n);
  if (picked.length < n) {
    picked.push(...used.slice(0, n - picked.length));
  }
  return picked;
}

// 把题目行投影为前端格式（不含 answer）
function toQuestion(r: QuestionRow): Omit<Question, 'answer'> {
  return {
    id: r.id,
    type: r.type as Question['type'],
    stem: r.stem,
    options: JSON.parse(r.options) as string[],
    explanation: null,
    source: r.source,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
  };
}

export async function questionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/questions/pending', { preHandler: requireAuth }, async (request) => {
    const row = getDb().prepare('SELECT questions FROM exam_sessions WHERE user_id = ? AND submitted_at IS NULL').get(request.user!.userId) as { questions: string } | undefined;
    return { ok: true, data: { questions: row ? (JSON.parse(row.questions) as QuestionRow[]).map(toQuestion) : [] } };
  });
  // 随机抽题（需 JWT）：固定配比 4 单选 + 4 判断 + 2 多选，优先未做过的题；count 取 1-10 决定卷面题数
  app.get('/api/questions/random', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.userId;
    const db = getDb();
    const query = request.query as { count?: unknown };
    const countParam = Number(query.count);
    const wanted = Number.isSafeInteger(countParam) && countParam >= 1 ? Math.min(countParam, 10) : 10;

    // Resume an issued paper before checking remaining quota; never charge twice.
    const pending = db.prepare('SELECT questions FROM exam_sessions WHERE user_id = ? AND submitted_at IS NULL').get(userId) as { questions: string } | undefined;
    if (pending) {
      return reply.send({ ok: true, data: { questions: (JSON.parse(pending.questions) as QuestionRow[]).map(toQuestion) } });
    }
    if (userLocked(userId)) {
      return reply.code(403).send({ ok: false, error: '免费额度已用完，请激活 VIP 后继续' });
    }
    const user = db.prepare('SELECT free_used_count, vip_activated_at FROM users WHERE id = ?').get(userId) as { free_used_count: number; vip_activated_at: number | null };
    const limit = user.vip_activated_at === null ? Math.min(wanted, config.freeQuestionLimit - user.free_used_count) : wanted;
    const exclude = pastQuestionIds(userId);
    const rows: QuestionRow[] = [];
    for (const plan of EXAM_PLAN) rows.push(...pickByType(db, plan.type, plan.count, exclude));
    const selected = rows.slice(0, limit);
    if (!selected.length) return reply.code(503).send({ ok: false, error: '题库暂无可用题目' });
    db.transaction(() => {
      db.prepare('INSERT INTO exam_sessions (user_id, questions, created_at) VALUES (?, ?, ?)').run(userId, JSON.stringify(selected), Date.now());
      if (user.vip_activated_at === null) db.prepare('UPDATE users SET free_used_count = free_used_count + ? WHERE id = ?').run(selected.length, userId);
    })();
    const questions = selected.map(toQuestion);

    return reply.send({ ok: true, data: { questions } });
  });
}
