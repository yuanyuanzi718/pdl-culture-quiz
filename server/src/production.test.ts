import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import getDb, { closeDb } from './db/index.js';
import { chatCompletion } from './services/deepseek.js';
import { usageStats } from './services/analytics.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
let user: { id: number; deviceId: string };
let auth: { authorization: string };
const admin = () => ({ 'x-admin-token': config.adminToken });
const guest = async () => {
  const response = await app.inject({ method: 'POST', url: '/api/profile/guest', payload: { deviceId: randomUUID() } });
  expect(response.statusCode).toBe(200);
  return response.json().data;
};
const draw = async () => (await app.inject({ method: 'GET', url: '/api/questions/random', headers: auth })).json().data.questions as Array<{ id: number; type: string; explanation: string | null }>;
const submit = (ids: number[], answers: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/exam/submit', headers: auth, payload: { userId: user.id, questionIds: ids, answers } });
const issue = (reference = 'QA-TRANSACTION-000001', userId = user.id) => app.inject({ method: 'POST', url: '/api/admin/vip-codes/issue', headers: admin(), payload: { userId, paymentReference: reference, confirmed: true } });
const activate = (code: string, deviceId = user.deviceId) => app.inject({ method: 'POST', url: '/api/vip/activate', headers: auth, payload: { userId: user.id, code, deviceId } });
const asVip = () => getDb().prepare('UPDATE users SET vip_activated_at=? WHERE id=?').run(Date.now(), user.id);

beforeEach(async () => {
  closeDb(); dir = mkdtempSync(join(tmpdir(), 'pdl-real-db-')); process.env.DATABASE_PATH = join(dir, 'qa.db');
  app = await buildApp();
  const data = await guest(); user = data.user; auth = { authorization: `Bearer ${data.token}` };
});
afterEach(async () => { await app.close(); closeDb(); delete process.env.DATABASE_PATH; rmSync(dir, { recursive: true, force: true }); });

describe('真实数据库全路由回归', () => {
  it('健康检查和273道题库可用', async () => {
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n).toBe(273);
  });
  it('同一设备复用身份，空设备及过长设备拒绝', async () => {
    const repeat = await app.inject({ method: 'POST', url: '/api/profile/guest', payload: { deviceId: user.deviceId } });
    expect(repeat.json().data.user.id).toBe(user.id);
    for (const deviceId of ['', 'x'.repeat(129), 12]) expect((await app.inject({ method: 'POST', url: '/api/profile/guest', payload: { deviceId } })).statusCode).toBe(400);
  });
  it('旧支付、伪回调、短信发码路由全部不存在且无交易副作用', async () => {
    for (const url of ['/api/payment/alipay/create', '/api/payment/alipay/notify', '/api/sms/send']) {
      expect((await app.inject({ method: 'POST', url, headers: auth, payload: { userId: user.id } })).statusCode).toBe(404);
    }
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0);
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM vip_codes').get() as { n: number }).n).toBe(0);
  });
  it('管理员接口拒绝普通用户和错误令牌', async () => {
    for (const url of ['/api/admin/stats', '/api/admin/users', '/api/admin/orders', '/api/admin/vip-codes', '/api/admin/questions']) {
      expect((await app.inject({ url, headers: auth })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: admin() })).statusCode).toBe(200);
    }
  });
  it('抽题配比正确，无答案或解析泄漏，刷新只领取同一试卷', async () => {
    asVip();
    const saved = config.examQuestionsPerRound;
    config.examQuestionsPerRound = 5;
    try {
      const first = await draw(); const second = await draw();
      expect(first.length).toBe(5); expect(first).toEqual(second);
      expect(first.map(q => q.type)).toEqual(['single','single','single','judge','multi']);
      for (const q of first) {
        expect(q).not.toHaveProperty('answer'); expect(q.explanation).toBeNull();
        const row = getDb().prepare('SELECT options,answer FROM questions WHERE id=?').get(q.id) as {options:string;answer:string};
        if(q.type === 'single') expect(JSON.parse(row.options).length).toBeGreaterThan(2);
        if(q.type === 'multi') expect(JSON.parse(row.answer).length).toBeLessThan(JSON.parse(row.options).length);
      }
      expect((getDb().prepare('SELECT free_used_count AS n FROM users WHERE id=?').get(user.id) as { n: number }).n).toBe(0);
    } finally { config.examQuestionsPerRound = saved; }
  });
  it('每次题数由配置决定，题型配比按 6:2:2 换算', async () => {
    asVip();
    const saved = config.examQuestionsPerRound;
    config.examQuestionsPerRound = 10;
    try {
      const qs = await draw();
      expect(qs.length).toBe(10);
      expect(qs.map(q => q.type)).toEqual(['single','single','single','single','single','single','judge','judge','multi','multi']);
    } finally { config.examQuestionsPerRound = saved; }
  });
  it('老库按题数累计的用量在启动时换算成次数', () => {
    const db = getDb();
    db.prepare('INSERT INTO exam_sessions (user_id, questions, created_at) VALUES (?, ?, ?)').run(user.id, '[]', Date.now());
    db.prepare('UPDATE users SET free_used_count=10 WHERE id=?').run(user.id);
    closeDb();
    const after = getDb().prepare('SELECT free_used_count AS n FROM users WHERE id=?').get(user.id) as { n: number };
    expect(after.n).toBe(1);
  });
  it('正确答案满分，重复交卷不重复落记录', async () => {
    const qs = await draw(); expect(qs.length).toBe(config.examQuestionsPerRound);
    const answers: Record<string, unknown> = {};
    for (const q of qs) { const row = getDb().prepare('SELECT answer FROM questions WHERE id=?').get(q.id) as {answer: string}; answers[q.id] = q.type === 'multi' ? JSON.parse(row.answer) : row.answer; }
    const response = await submit(qs.map(q => q.id), answers);
    expect(response.json().data.score).toBe(100);
    expect(response.json().data.details.filter((d: { correctAnswer: unknown }) => Array.isArray(d.correctAnswer)).length).toBe(qs.filter(q => q.type === 'multi').length);
    expect((await submit(qs.map(q => q.id), answers)).statusCode).toBe(409);
    const records = await app.inject({ url: `/api/exam/records/${user.id}`, headers: auth }); expect(records.json().data.records.length).toBe(1);
  });
  it('拒绝未领取、篡改、重复和非法题目编号', async () => {
    expect((await submit([1])).statusCode).toBe(409);
    asVip();
    const qs = await draw(); const ids = qs.map(q => q.id);
    for (const bad of [[999999], [ids[0],ids[0]], [0], ['1'], ids.slice(0, -1)]) expect((await submit(bad as number[])).statusCode).toBe(400);
  });
  it('管理员编辑后仍按领取时的试卷快照判分', async () => {
    asVip();
    const qs = await draw(); const q = qs[0];
    const row = getDb().prepare('SELECT answer FROM questions WHERE id=?').get(q.id) as { answer: string };
    getDb().prepare("UPDATE questions SET answer='Z' WHERE id=?").run(q.id);
    const result = await submit(qs.map(q => q.id), { [q.id]: row.answer });
    expect(result.json().data.details.find((d: {questionId: number}) => d.questionId===q.id).correct).toBe(true);
  });
  it('免费次数用尽后锁定，空题库不扣次数', async () => {
    // 用完全部免费答题次数：每次一套完整试卷，按次扣 1
    for (let i = 0; i < config.freeExamLimit; i++) {
      const qs = await draw();
      await submit(qs.map(q => q.id));
    }
    expect((await app.inject({ url: '/api/questions/random', headers: auth })).statusCode).toBe(403);
    // 重置为全新免费用户 + 空题库：抽题失败但不扣次数
    getDb().prepare('UPDATE users SET free_used_count=0 WHERE id=?').run(user.id);
    getDb().prepare('DELETE FROM exam_sessions WHERE user_id=?').run(user.id);
    getDb().prepare('DELETE FROM questions').run();
    expect((await app.inject({ url: '/api/questions/random', headers: auth })).statusCode).toBe(503);
    expect((getDb().prepare('SELECT free_used_count AS n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(0);
  });
  it('个人资料和考试记录不允许越权', async () => {
    const other = await guest();
    for (const url of [`/api/profile/${other.user.id}`, `/api/exam/records/${other.user.id}`]) expect((await app.inject({ url,headers:auth })).statusCode).toBe(403);
  });
  it('真实发码需确认到账且重复交易单号不重复生成', async () => {
    expect((await app.inject({method:'POST',url:'/api/admin/vip-codes/issue',headers:admin(),payload:{userId:user.id,paymentReference:'QA-123456',confirmed:false}})).statusCode).toBe(400);
    const first=await issue(); expect(first.statusCode).toBe(200); const again=await issue(); expect(again.json().data).toEqual(first.json().data);
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM orders').get() as {n:number}).n).toBe(1);
    expect((await activate(first.json().data.code)).json().data.user.vipActivatedAt).toBeGreaterThan(0);
    expect((await activate(first.json().data.code)).json().data.activated).toBe(true);
  });
  it('后台直接生成的激活码可立即发送给用户激活', async () => {
    const issued = await app.inject({ method: 'POST', url: '/api/admin/vip-codes/issue', headers: admin(), payload: {} });
    expect(issued.statusCode).toBe(200);
    const code = issued.json().data.code as string;
    const record = getDb().prepare('SELECT status, sent_at FROM vip_codes WHERE code=?').get(code) as { status: string; sent_at: number | null };
    expect(record.status).toBe('sent');
    expect(record.sent_at).toBeTypeOf('number');
    expect((await activate(code)).statusCode).toBe(200);
  });
  it('激活校验真实设备，已发给别人不可领取，解绑后可迁移', async () => {
    const first=(await issue()).json().data;
    expect((await activate(first.code,'another-device-123456789')).statusCode).toBe(403);
    const other=await guest(); const otherAuth={authorization:`Bearer ${other.token}`};
    const tryOther=()=>app.inject({method:'POST',url:'/api/vip/activate',headers:otherAuth,payload:{userId:other.user.id,deviceId:other.user.deviceId,code:first.code}});
    expect((await tryOther()).statusCode).toBe(403);
    expect((await activate(first.code)).statusCode).toBe(200);
    const second=(await issue('QA-TRANSACTION-000002')).json().data;
    expect((await activate(second.code)).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/vip/unbind',headers:auth,payload:{}})).statusCode).toBe(200);
    expect((await tryOther()).json().data.activated).toBe(true);
    expect((getDb().prepare('SELECT vip_activated_at FROM users WHERE id=?').get(user.id) as {vip_activated_at:unknown}).vip_activated_at).toBeNull();
  });
  it('过期从发放时间计算，过期码不能激活', async () => {
    const {code}=(await issue()).json().data;
    getDb().prepare('UPDATE vip_codes SET sent_at=? WHERE code=?').run(Date.now()-(config.vipCodeValidHours+1)*3600000,code);
    expect((await activate(code)).statusCode).toBe(400);
  });
  it('题库增改查删完整闭环，非法答案和重复选项拒绝', async () => {
    const q={type:'multi',stem:'QA隔离测试题',options:['甲','乙','丙'],answer:['A','C'],explanation:'QA',source:'隔离测试'};
    const create=await app.inject({method:'POST',url:'/api/admin/questions',headers:admin(),payload:q}); expect(create.statusCode).toBe(200); const id=create.json().data.id;
    const update=await app.inject({method:'PUT',url:`/api/admin/questions/${id}`,headers:admin(),payload:{...q,answer:['A','B']}});expect(update.statusCode).toBe(200);
    const list=await app.inject({url:'/api/admin/questions?keyword=QA隔离',headers:admin()}); expect(list.json().data.list[0].answer).toEqual(['A','B']);
    for (const change of [{answer:['A','Z']},{answer:['A','A']},{options:['甲','甲']},{type:'judge'},{answer:['A']}]) expect((await app.inject({method:'POST',url:'/api/admin/questions',headers:admin(),payload:{...q,...change}})).statusCode).toBe(400);
    expect((await app.inject({method:'DELETE',url:`/api/admin/questions/${id}`,headers:admin()})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:`/api/admin/questions/${id}`,headers:admin()})).statusCode).toBe(404);
  });
  it('AI未配置时明确失败且不扣次数、不生成假回答', async () => {
    const key=config.deepseek.apiKey;config.deepseek.apiKey='';
    try {
      const response=await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'文化核心'}});expect(response.statusCode).toBe(503);
      expect((getDb().prepare('SELECT COUNT(*) AS n FROM chat_logs').get() as {n:number}).n).toBe(0);
      expect((getDb().prepare('SELECT chat_free_used_count AS n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(0);
    } finally {config.deepseek.apiKey=key;}
  });
  it('AI越权、空问题、超长问题和用尽额度拒绝', async () => {
    for (const [payload,status] of [[{userId:user.id+999,message:'问题'},403],[{userId:user.id,message:''},400],[{userId:user.id,message:'问'.repeat(6001)},400]] as const) expect((await app.inject({method:'POST',url:'/api/chat',headers:auth,payload})).statusCode).toBe(status);
    getDb().prepare('UPDATE users SET chat_free_used_count=? WHERE id=?').run(config.freeChatLimit,user.id);
    expect((await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'文化'}})).statusCode).toBe(403);
  });
  it('每日对话次数达到上限后拒绝且不落库、不调AI', async () => {
    const insert = getDb().prepare("INSERT INTO chat_logs(user_id,role,content,created_at) VALUES (?,?,'历史',?)");
    getDb().transaction(() => { for (let i = 0; i < config.chatDailyLimit; i++) insert.run(user.id, 'user', Date.now()); })();
    const response = await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'超出上限的问题'}});
    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe('DAILY_LIMIT');
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM chat_logs').get() as {n:number}).n).toBe(config.chatDailyLimit);
  });
  it('AI聊天历史按当前身份读取', async () => {
    const other=await guest(); getDb().prepare("INSERT INTO chat_logs(user_id,role,content,created_at) VALUES (?,'user','他人对话',?)").run(other.user.id,Date.now());
    expect((await app.inject({url:'/api/chat/history',headers:auth})).json().data.messages).toEqual([]);
  });
  it('AI上游返回空内容时拒绝成功状态', async () => {
    // Disposable HTTP fixture, never a production fallback or persisted business record.
    const upstream=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:''}}]}));});
    await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    const address=upstream.address() as {port:number}; const saved={...config.deepseek};
    Object.assign(config.deepseek,{baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:'isolated-test',model:'isolated-test'});
    try {await expect(chatCompletion('问题')).rejects.toThrow('空内容');}
    finally {Object.assign(config.deepseek,saved); await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
  });
  it('AI并发请求不重复扣费，成功对话与引用可恢复', async () => {
    let release!: () => void;
    let arrived!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const upstream = createServer(async (_req, res) => {
      arrived(); await gate;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '隔离测试响应' } }] }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number }; const saved = {...config.deepseek};
    Object.assign(config.deepseek, {baseUrl:`http://127.0.0.1:${address.port}`,apiKey:'isolated-test',model:'isolated-test'});
    try {
      const first = app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'精神层面与实体层面的关系'}}).then(r=>r);
      await entered;
      expect((await app.inject({method:'POST',url:'/api/chat/new',headers:auth,payload:{}})).statusCode).toBe(409);
      expect((await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'同一时刻的问题'}})).statusCode).toBe(409);
      release(); expect((await first).statusCode).toBe(200);
      const logs=(await app.inject({url:'/api/chat/history',headers:auth})).json().data.messages;
      expect(logs.map((m:{role:string})=>m.role)).toEqual(['user','assistant']);
      expect(logs[1].references.length).toBeGreaterThan(0);
      expect((getDb().prepare('SELECT chat_free_used_count AS n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(1);
    } finally {release();Object.assign(config.deepseek,saved);await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
  });
  it('游客登录限流生效', async () => {
    let last=0;
    for(let i=0;i<21;i++) last=(await app.inject({method:'POST',url:'/api/profile/guest',payload:{deviceId:randomUUID()}})).statusCode;
    expect(last).toBe(429);
  });

});


describe('运营统计与用户清理', () => {
  it('每日访问按设备去重，按上海自然日统计成功交卷和真实提问', async () => {
    for (let i=0; i<2; i++) expect((await app.inject({method:'POST',url:'/api/profile/visit',headers:auth})).statusCode).toBe(200);
    expect(usageStats().today.visitors).toBe(1);
    const midnight = Date.parse('2026-10-08T00:00:00+08:00');
    getDb().prepare("INSERT INTO chat_logs(user_id,role,content,created_at,kind) VALUES (?,'user','问题',?,'chat')").run(user.id,midnight);
    getDb().prepare("INSERT INTO chat_logs(user_id,role,content,created_at,kind) VALUES (?,'user','昨日',?,'chat')").run(user.id,midnight-1);
    getDb().prepare("INSERT INTO chat_logs(user_id,role,content,created_at,kind) VALUES (?,'user','引导',?,'preset')").run(user.id,midnight);
    const data = usageStats(midnight);
    expect(data.today.chats).toBe(1);
    expect(data.daily[28].chats).toBe(1);
  });
  it('清理需要管理员与明确输入，备份成功后清除关联数据并拒绝旧令牌', async () => {
    const code=(await issue()).json().data.code;
    await activate(code);
    await draw();
    await app.inject({method:'POST',url:'/api/profile/visit',headers:auth});
    const clear = (headers:Record<string,string>, confirmation='清空全部用户') => app.inject({method:'DELETE',url:'/api/admin/users',headers,payload:{confirmation}});
    expect((await clear(auth)).statusCode).toBe(401);
    expect((await clear(admin(),'')).statusCode).toBe(400);
    const response=await clear(admin());
    expect(response.statusCode).toBe(200);
    expect(existsSync(join(dir,'backups',response.json().data.backup))).toBe(true);
    for(const table of ['users','exam_sessions','exam_records','chat_logs','daily_visits','ai_failures']) expect((getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n).toBe(0);
    expect(getDb().prepare('SELECT * FROM vip_codes WHERE code=?').get(code)).toBeUndefined();
    expect((await app.inject({url:'/api/chat/history',headers:auth})).statusCode).toBe(401);
    expect((getDb().prepare('SELECT user_id,amount FROM orders').get() as {user_id:null;amount:number}).user_id).toBeNull();
    const next=await guest();
    expect(next.user.id).toBeGreaterThan(user.id);
    expect(getDb().pragma('foreign_key_check')).toEqual([]);
  });
});


describe('管理员手动登记发码', () => {
  it('仅登记9.9元也可发码、保存收款记录并由用户激活', async () => {
    const response = await app.inject({method:'POST',url:'/api/admin/vip-codes/issue',headers:admin(),payload:{amount:9.9,wechatId:'local-test'}});
    expect(response.statusCode).toBe(200);
    const code=response.json().data.code;
    const row=getDb().prepare('SELECT status,amount,wechat_id,order_id FROM vip_codes WHERE code=?').get(code) as {status:string;amount:number;wechat_id:string;order_id:number};
    expect(row).toMatchObject({status:'sent',amount:9.9,wechat_id:'local-test'});
    expect(getDb().prepare('SELECT user_id,amount FROM orders WHERE id=?').get(row.order_id)).toMatchObject({user_id:null,amount:9.9});
    expect((await activate(code)).statusCode).toBe(200);
    for(const amount of [-1,0,'invalid']) expect((await app.inject({method:'POST',url:'/api/admin/vip-codes/issue',headers:admin(),payload:{amount}})).statusCode).toBe(400);
  });
});


describe('题库辨析题抽取与覆盖', () => {
  it('辨析题做过后仍优先抽未做过的基础题，不通过重复制造难度', async () => {
    asVip();
    const all = getDb().prepare('SELECT id,type,options,answer FROM questions').all() as Array<{id:number;type:string;options:string;answer:string}>;
    const done = all.filter(q => q.type === 'single' ? JSON.parse(q.options).length > 2 : q.type === 'multi' && JSON.parse(q.answer).length < JSON.parse(q.options).length).map(q => q.id);
    getDb().prepare('INSERT INTO exam_records(user_id,score,question_ids,answers,created_at) VALUES (?,0,?,\'{}\',?)').run(user.id,JSON.stringify(done),Date.now());
    const paper = await draw();
    expect(paper).toHaveLength(5);
    for(const q of paper) {
      expect(done).not.toContain(q.id);
      const row = all.find(r => r.id === q.id)!;
      if(q.type === 'single') expect(JSON.parse(row.options)).toHaveLength(2);
      if(q.type === 'multi') expect(JSON.parse(row.answer).length).toBe(JSON.parse(row.options).length);
    }
  });
});

describe('随机用户展示代号', () => {
  it('旧用户迁移后代号持久化，新用户不重复，前后台与会员状态一致', async () => {
    const db = getDb();
    db.exec('DROP INDEX unique_user_public_id; ALTER TABLE users DROP COLUMN public_id');
    closeDb();
    const migrated = getDb().prepare('SELECT public_id FROM users WHERE id=?').get(user.id) as {public_id:string};
    expect(migrated.public_id).toMatch(/^[A-Z2-9]{6}$/);
    closeDb();
    expect((getDb().prepare('SELECT public_id FROM users WHERE id=?').get(user.id) as {public_id:string}).public_id).toBe(migrated.public_id);
    const expected = `研习者 ${migrated.public_id}`;
    const repeated = await app.inject({method:'POST',url:'/api/profile/guest',payload:{deviceId:user.deviceId}});
    expect(repeated.json().data.user.displayName).toBe(expected);
    const other = await guest();
    expect(other.user.displayName).not.toBe(expected);
    const users = (await app.inject({url:'/api/admin/users',headers:admin()})).json().data.list;
    expect(users.find((u:{id:number})=>u.id===user.id).displayName).toBe(expected);
    const code=(await issue()).json().data.code;
    expect((await activate(code)).json().data.user.displayName).toBe(expected);
    const codes = (await app.inject({url:'/api/admin/vip-codes',headers:admin()})).json().data.list;
    expect(codes[0].userDisplayName).toBe(expected);
    const orders = (await app.inject({url:'/api/admin/orders',headers:admin()})).json().data.list;
    expect(orders[0].userDisplayName).toBe(expected);
  });
});

describe('截图对话', () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8L8AAAAASUVORK5CYII=';
  it('拒绝网址、伪造类型和超大图片，不扣次数', async () => {
    for(const value of ['https://example.com/private.png','data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,aGVsbG8=', 'data:image/png;base64,'+'A'.repeat(1500000)]) {
      const r=await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'识图',image:value}});
      expect([400,413]).toContain(r.statusCode);
    }
    expect((getDb().prepare('SELECT chat_free_used_count AS n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(0);
  });
  it('图片识别后检索多个题目，保留历史图片，整轮只扣一次', async () => {
    const bodies: Array<any> = [];
    const upstream = createServer(async (req,res) => {
      let body=''; for await(const part of req) body+=part;
      const data=JSON.parse(body); bodies.push(data);
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({choices:[{message:{content:Array.isArray(data.messages.at(-1).content) ? '1. 你喜欢并非常认同胖东来的企业文化吗？ A. 非常认同 B. 不认同\n2. 你是一个内心有爱和成人之美的人吗？ A. 是 B. 不是' : '1. A 非常认同\n2. A 是'}}]}));
    });
    await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
    const saved={...config.deepseek}; Object.assign(config.deepseek,{apiKey:'isolated-test',model:'text',visionModel:'vision',baseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`});
    try {
      const r=await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,image}});
      expect(r.statusCode).toBe(200); expect(bodies).toHaveLength(2);
      expect(bodies[0].model).toBe('vision'); expect(bodies[1].model).toBe('text');
      expect(bodies[1].messages.at(-1).content).toContain('题库参考答案');
      const logs=(await app.inject({url:'/api/chat/history',headers:auth})).json().data.messages;
      expect(logs[0].image).toBe(image); expect(logs[0].content).toContain('成人之美'); expect(logs[1].image).toBeNull();
      expect((getDb().prepare('SELECT chat_free_used_count AS n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(1);
    } finally {Object.assign(config.deepseek,saved);await new Promise<void>(r=>upstream.close(()=>r()));}
  });
  it('读图失败不留半条消息、不扣次数，允许重试', async () => {
    const upstream=createServer((_req,res)=>{res.statusCode=500;res.end('{}')});
    await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
    const saved={...config.deepseek}; Object.assign(config.deepseek,{apiKey:'isolated-test',model:'text',baseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`});
    try {
      for(let i=0;i<2;i++) expect((await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,image}})).statusCode).toBe(502);
      expect((getDb().prepare('SELECT COUNT(*) AS n FROM chat_logs').get() as {n:number}).n).toBe(0);
      expect((getDb().prepare('SELECT chat_free_used_count AS n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(0);
    } finally {Object.assign(config.deepseek,saved);await new Promise<void>(r=>upstream.close(()=>r()));}
  });
});

describe('图片自动过期清理', () => {
  it('24小时边界清图保留文字和答案，未过期图片不受影响，磁盘页得到回收', async () => {
    const {cleanExpiredImages,IMAGE_RETENTION_MS}=await import('./services/image-retention.js');
    const db=getDb(); const now=Date.now();
    const insert=db.prepare("INSERT INTO chat_logs(user_id,role,content,image_data,created_at) VALUES (?,'user','保留识别文字',?,?)");
    const old=insert.run(user.id,'data:image/jpeg;base64,'+'A'.repeat(400000),now-IMAGE_RETENTION_MS);
    const recent=insert.run(user.id,'recent-image',now-IMAGE_RETENTION_MS+10000);
    db.prepare("INSERT INTO chat_logs(user_id,role,content,created_at) VALUES (?,'assistant','答案',?)").run(user.id,now);
    const history=(await app.inject({url:'/api/chat/history',headers:auth})).json().data.messages;
    expect(history[0].image).toBeNull(); expect(history[1].image).toBe('recent-image');
    const pagesBefore=db.pragma('page_count',{simple:true}) as number;
    expect(cleanExpiredImages(now)).toBe(1);
    expect(db.prepare('SELECT image_data,content FROM chat_logs WHERE id=?').get(old.lastInsertRowid)).toEqual({image_data:null,content:'保留识别文字'});
    expect((db.prepare('SELECT image_data FROM chat_logs WHERE id=?').get(recent.lastInsertRowid) as {image_data:string}).image_data).toBe('recent-image');
    expect((db.prepare('SELECT COUNT(*) n FROM chat_logs').get() as {n:number}).n).toBe(3);
    expect(db.pragma('auto_vacuum',{simple:true})).toBe(2);
    expect(db.pragma('page_count',{simple:true})).toBeLessThan(pagesBefore);
    expect(cleanExpiredImages(now)).toBe(0);
  });
});

describe('新对话重置', () => {
  it('清理自己的文字、图片、引用与上下文，保留额度和使用统计，刷新不恢复旧消息', async () => {
    const db=getDb();const other=await guest();
    const insert=db.prepare("INSERT INTO chat_logs(user_id,role,content,image_data,references_json,created_at) VALUES (?,?,?,?,?,?)");
    insert.run(user.id,'user','旧问题','old-image',null,Date.now());
    insert.run(user.id,'assistant','旧答案',null,'[]',Date.now());
    insert.run(other.user.id,'user','其他用户',null,null,Date.now());
    db.prepare('UPDATE users SET chat_free_used_count=1 WHERE id=?').run(user.id);
    expect((await app.inject({method:'POST',url:'/api/chat/new',payload:{}})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/chat/new',headers:auth,payload:{}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/chat/history',headers:auth})).json().data.messages).toEqual([]);
    expect(db.prepare('SELECT content,image_data,references_json,archived FROM chat_logs WHERE user_id=?').all(user.id)).toEqual([
      {content:'',image_data:null,references_json:null,archived:1},{content:'',image_data:null,references_json:null,archived:1}
    ]);
    expect((db.prepare('SELECT chat_free_used_count n FROM users WHERE id=?').get(user.id) as {n:number}).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM chat_logs WHERE user_id=? AND role='user' AND kind='chat'").get(user.id) as {n:number}).n).toBe(1);
    expect((db.prepare('SELECT content FROM chat_logs WHERE user_id=?').get(other.user.id) as {content:string}).content).toBe('其他用户');
    let received: any;
    const upstream=createServer(async(req,res)=>{let text='';for await(const chunk of req) text+=chunk;received=JSON.parse(text);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'新答案'}}]}));});
    await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
    const saved={...config.deepseek};Object.assign(config.deepseek,{apiKey:'isolated-test',model:'text',baseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`});
    try {
      expect((await app.inject({method:'POST',url:'/api/chat',headers:auth,payload:{userId:user.id,message:'全新问题'}})).statusCode).toBe(200);
      expect(received.messages).toHaveLength(2);
      expect(JSON.stringify(received.messages)).not.toContain('旧问题');
      expect((await app.inject({url:'/api/chat/history',headers:auth})).json().data.messages.map((m:{content:string})=>m.content)).toEqual(['全新问题','新答案']);
    } finally {Object.assign(config.deepseek,saved);await new Promise<void>(r=>upstream.close(()=>r()));}
  });
});
