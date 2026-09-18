// 考试路由：提交判分 + 查询考试记录
import type { FastifyInstance } from 'fastify';
import getDb from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { ExamSubmitPayload } from '../types.js';

// 题目行结构
interface QuestionRow {
  id: number;
  type: string;
  stem: string;
  options: string;
  answer: string;
  explanation: string | null;
  source: string | null;
}

// 单题判分明细
interface QuestionDetail {
  questionId: number;
  correct: boolean;
  correctAnswer: string | string[];
  userAnswer: string;
  explanation: string | null;
}

// 把单个答案值转成大写字母（A/B/C/D）；若为选项文本则映射到选项索引
function toLetter(value: string, options: string[]): string {
  if (!value) return '';
  // 已经是单字母
  if (/^[A-Za-z]$/.test(value)) return value.toUpperCase();
  // 选项文本 -> 索引字母
  const idx = options.indexOf(value);
  if (idx >= 0) return String.fromCharCode(65 + idx);
  // 兼容 "A、B" / "AB" 这类已有字母串
  return value.toUpperCase();
}

// 解析标准答案：单选/判断存单字母或字母串；多选存 JSON 字母数组
function parseCorrectAnswer(correctAnswer: string): string[] {
  try {
    const parsed = JSON.parse(correctAnswer) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).toUpperCase());
    }
  } catch {
    // 非数组，按字符拆分（如 "AB" -> ["A","B"]）
  }
  return correctAnswer
    .split('')
    .map((x) => x.toUpperCase())
    .filter((x) => /^[A-Z]$/.test(x));
}

// 答案比对：前端可能传选项文本或字母，统一转字母后比对
function isCorrect(userAnswer: string, correctAnswer: string, type: string, options: string[]): boolean {
  const correctLetters = parseCorrectAnswer(correctAnswer);

  // 解析用户答案为字符串数组
  let userValues: string[];
  if (type === 'multi') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(userAnswer);
    } catch {
      parsed = userAnswer.split('');
    }
    userValues = Array.isArray(parsed) ? parsed.map(String) : [userAnswer];
  } else {
    userValues = [userAnswer];
  }
  const userLetters = userValues.map((v) => toLetter(v, options));

  if (type === 'multi') {
    if (userLetters.length !== correctLetters.length) return false;
    const us = new Set(userLetters);
    return correctLetters.every((x) => us.has(x));
  }
  return userLetters[0] === correctLetters[0];
}

export async function examRoutes(app: FastifyInstance): Promise<void> {
  // 提交考试判分
  app.post('/api/exam/submit', { preHandler: requireAuth }, async (request, reply) => {
    const body = (request.body ?? {}) as Partial<ExamSubmitPayload>;
    const userId = body.userId;
    if (!userId || userId !== request.user!.userId) {
      return reply.code(403).send({ ok: false, error: '无权为他人提交考试' });
    }
    const questionIds = body.questionIds ?? [];
    const answers = body.answers ?? {};
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return reply.code(400).send({ ok: false, error: '题目列表不能为空' });
    }
    // 答案键须为数字题号，值须为短字符串或字符串数组，防止垃圾大字段写入考试记录
    const answerValid = typeof answers === 'object' && answers !== null && !Array.isArray(answers) &&
      Object.entries(answers).every(([key, value]) =>
        /^\d+$/.test(key) &&
        (
          (typeof value === 'string' && value.length <= 200) ||
          (Array.isArray(value) && value.length <= 10 && value.every((v) => typeof v === 'string' && v.length <= 200))
        )
      );
    if (!answerValid) {
      return reply.code(400).send({ ok: false, error: '答案格式无效' });
    }

    if (questionIds.length > 10 || questionIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(questionIds).size !== questionIds.length) {
      return reply.code(400).send({ ok: false, error: '试卷或答案格式无效' });
    }
    const db = getDb();
    const session = db.prepare('SELECT id, questions FROM exam_sessions WHERE user_id = ? AND submitted_at IS NULL').get(userId) as { id: number; questions: string } | undefined;
    if (!session) return reply.code(409).send({ ok: false, error: '没有待提交的试卷，请先开始考试' });
    const rows = JSON.parse(session.questions) as QuestionRow[];
    if (rows.length !== questionIds.length || rows.some((q) => !questionIds.includes(q.id))) {
      return reply.code(400).send({ ok: false, error: '提交题目与已领取试卷不一致' });
    }

    const details: QuestionDetail[] = [];
    let correctCount = 0;
    for (const q of rows) {
      const rawAnswer = answers[String(q.id)] ?? '';
      // 数组答案（多选）转 JSON 字符串以便 isCorrect 内部 JSON.parse；单值直接 String()
      const userAnswerStr = Array.isArray(rawAnswer) ? JSON.stringify(rawAnswer) : String(rawAnswer);
      const options = JSON.parse(q.options) as string[];
      const correct = isCorrect(userAnswerStr, q.answer, q.type, options);
      if (correct) correctCount++;
      details.push({
        questionId: q.id,
        correct,
        correctAnswer: q.type === 'multi' ? JSON.parse(q.answer) as string[] : q.answer,
        userAnswer: userAnswerStr,
        explanation: q.explanation,
      });
    }

    const score = questionIds.length > 0 ? Math.round((correctCount / questionIds.length) * 100) : 0;

    // 写考试记录
    const now = Date.now();
    db.transaction(() => {
    db.prepare(
      `INSERT INTO exam_records (user_id, score, question_ids, answers, created_at)
       VALUES (@userId, @score, @questionIds, @answers, @createdAt)`
    ).run({
      userId,
      score,
      questionIds: JSON.stringify(questionIds),
      answers: JSON.stringify(answers),
      createdAt: now,
    });
    db.prepare('UPDATE exam_sessions SET submitted_at = ? WHERE id = ?').run(now, session.id);
    })();

    // 注意：free_used_count 已在抽题接口（questions.ts）累加，交卷时不重复计费，
    // 否则同一批题目会被算两次免费额度。

    return reply.send({
      ok: true,
      data: { score, correctCount, total: questionIds.length, details },
    });
  });

  // 查询用户考试记录
  app.get('/api/exam/records/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number((request.params as { userId: string }).userId);
    if (request.user!.userId !== userId) {
      return reply.code(403).send({ ok: false, error: '无权访问他人记录' });
    }
    const db = getDb();
    const rows = db
      .prepare(
        'SELECT id, user_id, score, question_ids, answers, created_at FROM exam_records WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(userId) as Array<{
      id: number;
      user_id: number;
      score: number;
      question_ids: string;
      answers: string;
      created_at: number;
    }>;

    const records = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      score: r.score,
      questionIds: JSON.parse(r.question_ids) as number[],
      answers: JSON.parse(r.answers) as Record<string, string>,
      createdAt: r.created_at,
    }));

    return reply.send({ ok: true, data: { records } });
  });
}
