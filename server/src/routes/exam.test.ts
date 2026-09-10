// 判分与免费额度集成测试
// 运行：pnpm test
// 设计：用 Fastify inject 直接打到路由，不依赖真实 HTTP 端口；用 vi.mock 替换 db 模块，让路由读到测试 db。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

type DB = ReturnType<typeof Database>;

// 测试用 db 实例（每个用例前重置）
let testDb: DB;

// 用 vi.mock 替换 ../db/index.js 模块，让路由的 getDb 永远返回 testDb
vi.mock('../db/index.js', () => ({
  default: () => testDb,
  getDb: () => testDb,
  closeDb: () => {},
}));

// 引入要在 mock 之后生效
const { config } = await import('../config.js');
const { profileRoutes } = await import('./profile.js');
const { questionRoutes } = await import('./questions.js');
const { examRoutes } = await import('./exam.js');
const { signToken } = await import('../middleware/auth.js');

// 构造临时 sqlite db（含 schema + 3 道测试题）
function buildDb(): { db: DB; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pdl-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

  const insert = db.prepare(
    `INSERT INTO questions (type, stem, options, answer, explanation, source, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run('single', '单选题', JSON.stringify(['选项A', '选项B', '选项C']), 'B', '解释1', '测试', JSON.stringify(['t']));
  insert.run('multi', '多选题', JSON.stringify(['甲', '乙', '丙', '丁']), JSON.stringify(['A', 'C', 'D']), '解释2', '测试', JSON.stringify(['t']));
  insert.run('judge', '判断题', JSON.stringify(['正确', '错误']), 'A', '解释3', '测试', JSON.stringify(['t']));

  const cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { db, cleanup };
}

describe('考试判分与免费额度', () => {
  let app: FastifyInstance;
  let db: DB;
  let cleanup: () => void;
  let token: string;
  let userId: number;

  beforeEach(async () => {
    const ctx = buildDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    testDb = db; // 让 mock 的 getDb 返回这个

    app = Fastify({ logger: false });
    await app.register(profileRoutes);
    await app.register(questionRoutes);
    await app.register(examRoutes);

    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO users (phone, free_used_count, created_at) VALUES (?, 0, ?)'
    ).run('13800000999', now);
    userId = Number(info.lastInsertRowid);
    token = await signToken(userId, '13800000999');
  });

  afterEach(async () => {
    await app.close();
    cleanup();
  });

  it('选项文本答案应判分正确（修复前 bug：永远判错）', async () => {
    const drawResp = await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=3',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(drawResp.statusCode).toBe(200);
    const questions = drawResp.json().data.questions as Array<{
      id: number;
      type: string;
      options: string[];
    }>;
    expect(questions.length).toBe(3);

    // 全部答对：用选项文本作为答案
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const row = db.prepare('SELECT answer FROM questions WHERE id = ?').get(q.id) as { answer: string };
      if (q.type === 'multi') {
        const letters = JSON.parse(row.answer) as string[];
        answers[String(q.id)] = letters.map((L) => q.options[L.charCodeAt(0) - 65]);
      } else {
        answers[String(q.id)] = q.options[row.answer.charCodeAt(0) - 65];
      }
    }

    const submitResp = await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId, questionIds: questions.map((q) => q.id), answers },
    });
    const result = submitResp.json();
    expect(result.ok).toBe(true);
    expect(result.data.score).toBe(100);
    expect(result.data.correctCount).toBe(3);
    expect(result.data.total).toBe(3);
  });

  it('字母答案也应判分正确（兼容旧 API）', async () => {
    const drawResp = await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=3',
      headers: { authorization: `Bearer ${token}` },
    });
    const questions = drawResp.json().data.questions as Array<{ id: number; type: string }>;

    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const row = db.prepare('SELECT answer FROM questions WHERE id = ?').get(q.id) as { answer: string };
      answers[String(q.id)] = q.type === 'multi' ? JSON.parse(row.answer) : row.answer;
    }

    const submitResp = await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId, questionIds: questions.map((q) => q.id), answers },
    });
    const result = submitResp.json();
    expect(result.data.score).toBe(100);
    expect(result.data.correctCount).toBe(3);
  });

  it('答错应得 0 分', async () => {
    const drawResp = await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=3',
      headers: { authorization: `Bearer ${token}` },
    });
    const questions = drawResp.json().data.questions as Array<{ id: number }>;
    // 用不存在的字母，必然全错
    const answers: Record<string, string> = {};
    for (const q of questions) answers[String(q.id)] = 'Z';

    const submitResp = await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId, questionIds: questions.map((q) => q.id), answers },
    });
    const result = submitResp.json();
    expect(result.data.score).toBe(0);
    expect(result.data.correctCount).toBe(0);
  });

  it('抽题时累加 free_used_count，交卷时不应重复累加（修复 bug 2）', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=3',
      headers: { authorization: `Bearer ${token}` },
    });
    let user = db.prepare('SELECT free_used_count FROM users WHERE id = ?').get(userId) as {
      free_used_count: number;
    };
    expect(user.free_used_count).toBe(3);

    const ids = (db.prepare('SELECT id FROM questions').all() as Array<{ id: number }>)
      .map((r) => r.id)
      .slice(0, 3);
    await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId, questionIds: ids, answers: {} },
    });
    user = db.prepare('SELECT free_used_count FROM users WHERE id = ?').get(userId) as {
      free_used_count: number;
    };
    expect(user.free_used_count).toBe(3);
  });

  it('锁定用户不能抽题', async () => {
    db.prepare('UPDATE users SET free_used_count = ? WHERE id = ?').run(
      config.freeQuestionLimit,
      userId
    );
    const resp = await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(403);
    const body = resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('免费额度');
  });

  it('VIP 用户抽题不累加 free_used_count', async () => {
    db.prepare('UPDATE users SET vip_activated_at = ? WHERE id = ?').run(Date.now(), userId);
    const before = db.prepare('SELECT free_used_count FROM users WHERE id = ?').get(userId) as {
      free_used_count: number;
    };
    await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=3',
      headers: { authorization: `Bearer ${token}` },
    });
    const after = db.prepare('SELECT free_used_count FROM users WHERE id = ?').get(userId) as {
      free_used_count: number;
    };
    expect(after.free_used_count).toBe(before.free_used_count);
  });

  it('无 JWT 应返回 401', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/questions/random',
    });
    expect(resp.statusCode).toBe(401);
  });

  it('为他人提交考试应返回 403', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId: userId + 999, questionIds: [1], answers: {} },
    });
    expect(resp.statusCode).toBe(403);
  });

  it('题目列表为空应返回 400', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId, questionIds: [], answers: {} },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('考试记录应持久化并可查询', async () => {
    const drawResp = await app.inject({
      method: 'GET',
      url: '/api/questions/random?count=2',
      headers: { authorization: `Bearer ${token}` },
    });
    const questions = drawResp.json().data.questions as Array<{ id: number }>;
    await app.inject({
      method: 'POST',
      url: '/api/exam/submit',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { userId, questionIds: questions.map((q) => q.id), answers: {} },
    });

    const listResp = await app.inject({
      method: 'GET',
      url: `/api/exam/records/${userId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listResp.statusCode).toBe(200);
    const body = listResp.json();
    expect(body.ok).toBe(true);
    expect(body.data.records.length).toBe(1);
    expect(body.data.records[0].score).toBe(0);
    expect(body.data.records[0].questionIds.length).toBe(questions.length);
  });
});
