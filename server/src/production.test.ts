import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import getDb, { closeDb } from './db/index.js';
import { chatCompletion } from './services/deepseek.js';

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
    const first = await draw(); const second = await draw();
    expect(first.length).toBe(10); expect(first).toEqual(second);
    expect(first.map(q => q.type)).toEqual(['single','single','single','single','judge','judge','judge','judge','multi','multi']);
    for (const q of first) { expect(q).not.toHaveProperty('answer'); expect(q.explanation).toBeNull(); }
    expect((getDb().prepare('SELECT free_used_count AS n FROM users WHERE id=?').get(user.id) as { n: number }).n).toBe(10);
  });
  it('正确答案满分，交卷后免费锁定，重复交卷不重复落记录', async () => {
    const qs = await draw(); const answers: Record<string, unknown> = {};
    for (const q of qs) { const row = getDb().prepare('SELECT answer FROM questions WHERE id=?').get(q.id) as {answer: string}; answers[q.id] = q.type === 'multi' ? JSON.parse(row.answer) : row.answer; }
    const response = await submit(qs.map(q => q.id), answers);
    expect(response.json().data.score).toBe(100);
    expect(response.json().data.details.filter((d: { correctAnswer: unknown }) => Array.isArray(d.correctAnswer)).length).toBe(2);
    expect((await submit(qs.map(q => q.id), answers)).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/questions/random', headers: auth })).statusCode).toBe(403);
    const records = await app.inject({ url: `/api/exam/records/${user.id}`, headers: auth }); expect(records.json().data.records.length).toBe(1);
  });
  it('拒绝未领取、篡改、重复和非法题目编号', async () => {
    expect((await submit([1])).statusCode).toBe(409);
    const qs = await draw(); const ids = qs.map(q => q.id);
    for (const bad of [[999999], [ids[0],ids[0]], [0], ['1'], ids.slice(0,9)]) expect((await submit(bad as number[])).statusCode).toBe(400);
  });
  it('管理员编辑后仍按领取时的试卷快照判分', async () => {
    const qs = await draw(); const q = qs[0];
    const row = getDb().prepare('SELECT answer FROM questions WHERE id=?').get(q.id) as { answer: string };
    getDb().prepare("UPDATE questions SET answer='Z' WHERE id=?").run(q.id);
    const result = await submit(qs.map(q => q.id), { [q.id]: row.answer });
    expect(result.json().data.details.find((d: {questionId: number}) => d.questionId===q.id).correct).toBe(true);
  });
  it('剩余3道额度只发3题，空题库不扣额度', async () => {
    getDb().prepare('UPDATE users SET free_used_count=? WHERE id=?').run(config.freeQuestionLimit-3,user.id);
    expect((await draw()).length).toBe(3);
    await submit((await draw()).map(q=>q.id));
    getDb().prepare('UPDATE users SET free_used_count=0 WHERE id=?').run(user.id); getDb().prepare('DELETE FROM questions').run();
    expect((await app.inject({ url:'/api/questions/random', headers:auth })).statusCode).toBe(503);
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
