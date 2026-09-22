// 管理后台路由：统计、题库 CRUD、用户/订单/VIP 码查询
import type { FastifyInstance } from 'fastify';
import getDb from '../db/index.js';
import { createVipCode, markCodeSent } from '../services/vip-code.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/adminAuth.js';

// 题目数据库行（字段均为蛇形 + JSON 字符串）
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

// 题目请求体
interface QuestionBody {
  type?: unknown;
  stem?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
  source?: unknown;
  tags?: unknown;
}

// 归一化后的题目入库数据
interface NormalizedQuestion {
  type: 'single' | 'multi' | 'judge';
  stem: string;
  options: string; // JSON 字符串
  answer: string; // 多选为 JSON 字符串，其余为字母
  explanation: string | null;
  source: string | null;
  tags: string; // JSON 字符串
}

// 解析分页参数：page 从 1 开始，size 默认 20、最大 100
function parsePaging(query: Record<string, unknown>): { page: number; size: number; offset: number } {
  const page = Math.max(1, Math.trunc((Number.isFinite(Number(query.page)) ? Number(query.page) : 1) || 1));
  const size = Math.min(100, Math.max(1, Math.trunc((Number.isFinite(Number(query.size)) ? Number(query.size) : 20) || 20)));
  return { page, size, offset: (page - 1) * size };
}

// 将题目行转为驼峰输出（options/tags/多选 answer 需 JSON.parse）
function mapQuestion(r: QuestionRow): {
  id: number;
  type: string;
  stem: string;
  options: string[];
  answer: string | string[];
  explanation: string | null;
  source: string | null;
  tags: string[];
} {
  return {
    id: r.id,
    type: r.type,
    stem: r.stem,
    options: JSON.parse(r.options) as string[],
    answer: r.type === 'multi' ? (JSON.parse(r.answer) as string[]) : r.answer,
    explanation: r.explanation,
    source: r.source,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
  };
}

// 校验并归一化题目请求体，返回错误信息或入库数据
function normalizeQuestionBody(body: QuestionBody): { error: string } | { data: NormalizedQuestion } {
  const type = body.type;
  if (type !== 'single' && type !== 'multi' && type !== 'judge') {
    return { error: '题型非法，须为 single/multi/judge' };
  }
  const stem = typeof body.stem === 'string' ? body.stem.trim() : '';
  if (!stem) {
    return { error: '题干不能为空' };
  }
  if (!Array.isArray(body.options) || body.options.length < 2) {
    return { error: '选项至少需要 2 个' };
  }
  if (body.options.length > 26 || body.options.some((o) => typeof o !== 'string' || !o.trim())) return { error: '选项必须是非空文本且不超过26项' };
  const options = body.options.map((o) => (o as string).trim());
  if (new Set(options).size !== options.length) return { error: '选项不可重复' };
  // 判断题只需恰好两个选项（历史题目存在"是/不是"等多种措辞，不强制文案）
  if (type === 'judge' && options.length !== 2) return { error: '判断题必须恰好两个选项' };

  // 答案：多选存字母数组 JSON，单选/判断直接存字母
  let answer: string;
  if (type === 'multi') {
    if (!Array.isArray(body.answer) || body.answer.length === 0) {
      return { error: '多选题答案须为非空数组' };
    }
    answer = JSON.stringify(body.answer.map((a) => String(a)));
  } else {
    if (typeof body.answer !== 'string' || !body.answer.trim()) {
      return { error: '答案不能为空' };
    }
    answer = body.answer.trim();
  }

  const letters = type === 'multi' ? JSON.parse(answer) as string[] : [answer];
  const allowed = options.map((_, i) => String.fromCharCode(65 + i));
  if (letters.some((v) => !allowed.includes(v)) || new Set(letters).size !== letters.length || (type === 'multi' && letters.length < 2)) return { error: '答案必须对应有效选项，多选至少两项且不得重复' };
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t)) : [];

  return {
    data: {
      type,
      stem,
      options: JSON.stringify(options),
      answer,
      explanation: typeof body.explanation === 'string' && body.explanation ? body.explanation : null,
      source: typeof body.source === 'string' && body.source ? body.source : null,
      tags: JSON.stringify(tags),
    },
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // 人工发码：管理员确认后生成的码立即进入可激活的“已发放”状态。
  app.post('/api/admin/vip-codes/issue', { preHandler: requireAdmin }, async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: unknown; paymentReference?: unknown; confirmed?: unknown; wechatId?: unknown; amount?: unknown };
    const userId = typeof body.userId === 'number' ? body.userId : null;
    const paymentReference = typeof body.paymentReference === 'string' ? body.paymentReference.trim() : '';
    const confirmed = body.confirmed === true;
    const wechatId = typeof body.wechatId === 'string' ? body.wechatId.trim() : '';
    const amountVal = body.amount !== undefined ? Number(body.amount) : undefined;

    const db = getDb();
    // 正式发码请求即使暂未填写金额/微信号，也必须保留到账确认与目标用户校验。
    const hasPayment = userId !== null || paymentReference || confirmed || wechatId || (amountVal !== undefined && amountVal > 0);

    if (hasPayment) {
      if (!userId) return reply.code(400).send({ ok: false, error: '缺少目标用户' });
      if (!paymentReference) return reply.code(400).send({ ok: false, error: '缺少交易单号' });
      if (!confirmed) return reply.code(400).send({ ok: false, error: '需确认到账后方可发码' });

      const user = db.prepare('SELECT id FROM users WHERE id=?').get(userId) as { id: number } | undefined;
      if (!user) return reply.code(400).send({ ok: false, error: '目标用户不存在' });

      const existing = db.prepare("SELECT * FROM orders WHERE trade_no=?").get(paymentReference) as {
        id: number; user_id: number; amount: number;
      } | undefined;
      if (existing) {
        const code = db.prepare('SELECT code FROM vip_codes WHERE order_id=?').get(existing.id) as { code: string } | undefined;
        if (code) return reply.send({ ok: true, data: { code: code.code } });
      }

      const issue = db.transaction(() => {
        db.prepare("INSERT INTO orders (user_id, amount, trade_no, wechat_id, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?)")
          .run(userId, amountVal ?? config.vipPrice, paymentReference, wechatId || null, Date.now());
        const order = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
        const code = createVipCode();
        markCodeSent(code, userId, order.id);
        return code;
      });
      const code = issue();
      return reply.send({ ok: true, data: { code } });
    }

    // 无订单的人工发码：也必须标记为 sent，否则用户端会拒绝激活。
    const code = createVipCode();
    db.prepare("UPDATE vip_codes SET status='sent', sent_at=? WHERE code=?").run(Date.now(), code);
    return reply.send({ ok: true, data: { code } });
  });
  // 全局统计
  app.get('/api/admin/stats', { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const questionCount = (db.prepare('SELECT COUNT(*) AS c FROM questions').get() as { c: number }).c;
    const orderCount = (db.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number }).c;
    const paid = db
      .prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total FROM orders WHERE status = 'paid'")
      .get() as { c: number; total: number };
    const vipCodeCount = (db.prepare('SELECT COUNT(*) AS c FROM vip_codes').get() as { c: number }).c;
    const activatedVipCount = (
      db.prepare('SELECT COUNT(*) AS c FROM users WHERE vip_activated_at IS NOT NULL').get() as { c: number }
    ).c;

    return reply.send({
      ok: true,
      data: {
        userCount,
        questionCount,
        orderCount,
        paidOrderCount: paid.c,
        paidAmount: paid.total,
        vipCodeCount,
        activatedVipCount,
      },
    });
  });

  // 题目分页列表（keyword 模糊匹配题干）
  app.get('/api/admin/questions', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { page, size, offset } = parsePaging(query);
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const db = getDb();

    let rows: QuestionRow[];
    let total: number;
    if (keyword) {
      const like = `%${keyword}%`;
      total = (db.prepare('SELECT COUNT(*) AS c FROM questions WHERE stem LIKE ?').get(like) as { c: number }).c;
      rows = db
        .prepare('SELECT * FROM questions WHERE stem LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(like, size, offset) as QuestionRow[];
    } else {
      total = (db.prepare('SELECT COUNT(*) AS c FROM questions').get() as { c: number }).c;
      rows = db
        .prepare('SELECT * FROM questions ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(size, offset) as QuestionRow[];
    }

    return reply.send({ ok: true, data: { list: rows.map(mapQuestion), total, page, size } });
  });

  // 新建题目
  app.post('/api/admin/questions', { preHandler: requireAdmin }, async (request, reply) => {
    const body = (request.body ?? {}) as QuestionBody;
    const normalized = normalizeQuestionBody(body);
    if ('error' in normalized) {
      return reply.code(400).send({ ok: false, error: normalized.error });
    }
    const q = normalized.data;
    const db = getDb();
    const info = db
      .prepare(
        'INSERT INTO questions (type, stem, options, answer, explanation, source, tags) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(q.type, q.stem, q.options, q.answer, q.explanation, q.source, q.tags);
    return reply.send({ ok: true, data: { id: Number(info.lastInsertRowid) } });
  });

  // 更新题目
  app.put('/api/admin/questions/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ ok: false, error: '题目 id 非法' });
    }
    const body = (request.body ?? {}) as QuestionBody;
    const normalized = normalizeQuestionBody(body);
    if ('error' in normalized) {
      return reply.code(400).send({ ok: false, error: normalized.error });
    }
    const q = normalized.data;
    const db = getDb();
    const info = db
      .prepare(
        'UPDATE questions SET type = ?, stem = ?, options = ?, answer = ?, explanation = ?, source = ?, tags = ? WHERE id = ?'
      )
      .run(q.type, q.stem, q.options, q.answer, q.explanation, q.source, q.tags, id);
    if (info.changes === 0) {
      return reply.code(404).send({ ok: false, error: '题目不存在' });
    }
    return reply.send({ ok: true, data: { ok: true } });
  });

  // 删除题目
  app.delete('/api/admin/questions/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ ok: false, error: '题目 id 非法' });
    }
    const db = getDb();
    const info = db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    if (info.changes === 0) {
      return reply.code(404).send({ ok: false, error: '题目不存在' });
    }
    return reply.send({ ok: true, data: { ok: true } });
  });

  // 用户分页列表（含考试次数、锁定状态）
  app.get('/api/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { page, size, offset } = parsePaging(query);
    const db = getDb();

    interface UserListRow {
      id: number;
      phone: string | null;
      vip_activated_at: number | null;
      vip_code: string | null;
      free_used_count: number;
      created_at: number;
      exam_count: number;
    }

    const total = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const rows = db
      .prepare(
        `SELECT u.id, u.phone, u.vip_activated_at, u.vip_code, u.free_used_count, u.created_at,
                (SELECT COUNT(*) FROM exam_records e WHERE e.user_id = u.id) AS exam_count
         FROM users u
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(size, offset) as UserListRow[];

    const list = rows.map((r) => ({
      id: r.id,
      phone: r.phone?.startsWith('guest_') ? null : r.phone,
      vipActivatedAt: r.vip_activated_at,
      vipCode: r.vip_code,
      freeUsedCount: r.free_used_count,
      isLocked: r.free_used_count >= config.freeExamLimit && r.vip_activated_at === null,
      createdAt: r.created_at,
      examCount: r.exam_count,
    }));

    return reply.send({ ok: true, data: { list, total, page, size } });
  });

  // 订单分页列表（LEFT JOIN 用户取手机号）
  app.get('/api/admin/orders', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { page, size, offset } = parsePaging(query);
    const status = typeof query.status === 'string' ? query.status.trim() : '';
    const db = getDb();

    interface OrderListRow {
      id: number;
      user_id: number;
      user_phone: string | null;
      amount: number | null;
      trade_no: string | null;
      wechat_id: string | null;
      status: string;
      created_at: number;
    }

    const whereClause = status ? 'WHERE o.status = ?' : '';
    const countSql = `SELECT COUNT(*) AS c FROM orders o ${whereClause}`;
    const total = status
      ? (db.prepare(countSql).get(status) as { c: number }).c
      : (db.prepare(countSql).get() as { c: number }).c;

    const dataSql = `SELECT o.id, o.user_id, u.phone AS user_phone, o.amount, o.trade_no, o.wechat_id, o.status, o.created_at
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         ${whereClause}
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?`;
    const rows = status
      ? db.prepare(dataSql).all(status, size, offset) as OrderListRow[]
      : db.prepare(dataSql).all(size, offset) as OrderListRow[];

    const list = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userPhone: r.user_phone?.startsWith('guest_') ? null : r.user_phone,
      amount: r.amount,
      tradeNo: r.trade_no,
      wechatId: r.wechat_id,
      status: r.status,
      createdAt: r.created_at,
    }));

    return reply.send({ ok: true, data: { list, total, page, size } });
  });

  // 更新订单（手动补金额/微信号/状态）
  app.patch('/api/admin/orders/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const routeParams = request.params as { id: string };
    const id = Number(routeParams.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ ok: false, error: '无效的订单 ID' });
    const body = request.body as Record<string, unknown>;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM orders WHERE id=?').get(id) as { id: number } | undefined;
    if (!existing) return reply.code(404).send({ ok: false, error: '订单不存在' });

    const updates: string[] = [];
    const sqlParams: unknown[] = [];
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (body.amount !== null && (!Number.isFinite(amount) || amount < 0)) return reply.code(400).send({ ok: false, error: '金额无效' });
      updates.push('amount=?');
      sqlParams.push(amount);
    }
    if (body.wechatId !== undefined) {
      updates.push('wechat_id=?');
      sqlParams.push(typeof body.wechatId === 'string' ? body.wechatId.trim() : null);
    }
    if (body.status !== undefined) {
      const validStatuses = ['pending', 'paid', 'failed'];
      if (!validStatuses.includes(String(body.status))) return reply.code(400).send({ ok: false, error: '状态无效' });
      updates.push('status=?');
      sqlParams.push(body.status);
    }
    if (updates.length === 0) return reply.code(400).send({ ok: false, error: '没有需要更新的字段' });

    sqlParams.push(id);
    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id=?`).run(...sqlParams);
    return reply.send({ ok: true });
  });

  // 更新 VIP 码（补金额/微信号，同时创建订单）
  app.patch('/api/admin/vip-codes/:code', { preHandler: requireAdmin }, async (request, reply) => {
    const params = request.params as { code: string };
    const code = params.code;
    const body = request.body as Record<string, unknown>;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM vip_codes WHERE code=?').get(code) as Record<string, unknown> | undefined;
    if (!existing) return reply.code(404).send({ ok: false, error: '激活码不存在' });

    const wechatId = typeof body.wechatId === 'string' ? body.wechatId.trim() : null;
    const amount = body.amount !== undefined ? Number(body.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return reply.code(400).send({ ok: false, error: '金额无效' });

    const userId = existing.user_id as number | null;
    // 未绑定用户的码无法生成收款订单，明确拒绝而不是静默丢失金额
    if (amount !== null && amount > 0 && !userId) {
      return reply.code(400).send({ ok: false, error: '该激活码未关联用户，无法记账收款；请通过发码流程对用户发码' });
    }

    const update = db.transaction(() => {
      // 更新 vip_codes
      const sets: string[] = [];
      const params: unknown[] = [];
      if (wechatId !== null) { sets.push('wechat_id=?'); params.push(wechatId); }
      if (amount !== null) { sets.push('amount=?'); params.push(amount); }
      if (sets.length > 0) {
        params.push(code);
        db.prepare(`UPDATE vip_codes SET ${sets.join(', ')} WHERE code=?`).run(...params);
      }

      // 如果有金额，创建/更新订单
      if (amount !== null && amount > 0) {
        const order = db.prepare('SELECT id FROM orders WHERE user_id=? AND status=?').get(userId, 'pending') as { id: number } | undefined;
        if (order) {
          db.prepare('UPDATE orders SET amount=?, wechat_id=?, status=? WHERE id=?').run(amount, wechatId, 'paid', order.id);
        } else if (userId) {
          db.prepare("INSERT INTO orders (user_id, amount, wechat_id, status, created_at) VALUES (?, ?, ?, 'paid', ?)")
            .run(userId, amount, wechatId, Date.now());
        }
      }
    });
    update();
    return reply.send({ ok: true });
  });

  // VIP 码分页列表（可按 status 筛选，LEFT JOIN 用户取手机号）
  app.get('/api/admin/vip-codes', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { page, size, offset } = parsePaging(query);
    const status = typeof query.status === 'string' ? query.status.trim() : '';
    const db = getDb();

    interface VipCodeListRow {
      code: string;
      status: string;
      user_id: number | null;
      user_phone: string | null;
      order_id: number | null;
      wechat_id: string | null;
      amount: number | null;
      sent_at: number | null;
      activated_at: number | null;
      created_at: number;
    }

    const where = status ? 'WHERE v.status = ?' : '';
    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM vip_codes v ${where}`).get(...(status ? [status] : [])) as { c: number }
    ).c;
    const rows = db
      .prepare(
        `SELECT v.code, v.status, v.user_id, u.phone AS user_phone, v.order_id, v.wechat_id, v.amount, v.sent_at, v.activated_at, v.created_at
         FROM vip_codes v
         LEFT JOIN users u ON u.id = v.user_id
         ${where}
         ORDER BY v.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...(status ? [status] : []), size, offset) as VipCodeListRow[];

    const list = rows.map((r) => ({
      code: r.code,
      status: r.status,
      userId: r.user_id,
      userPhone: r.user_phone?.startsWith('guest_') ? null : r.user_phone,
      orderId: r.order_id,
      wechatId: r.wechat_id,
      amount: r.amount,
      sentAt: r.sent_at,
      activatedAt: r.activated_at,
      createdAt: r.created_at,
    }));

    return reply.send({ ok: true, data: { list, total, page, size } });
  });
}
