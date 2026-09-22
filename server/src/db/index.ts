// 数据库实例 + 初始化
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { importQuestionsFromJson } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const SCHEMA_PATH = join(__dirname, '..', '..', 'src', 'db', 'schema.sql');

// 单例数据库实例
let dbInstance: DatabaseType | null = null;

// 获取数据库实例（懒加载 + 初始化）
export function getDb(): DatabaseType {
  if (dbInstance) return dbInstance;

  const DB_PATH = process.env.DATABASE_PATH || join(DATA_DIR, 'pdl-culture.db');
  if (process.env.NODE_ENV === 'test' && (!process.env.DATABASE_PATH || resolve(DB_PATH) === resolve(DATA_DIR, 'pdl-culture.db'))) throw new Error('测试必须使用独立 DATABASE_PATH');

  // 确保数据目录存在（better-sqlite3 不会自动创建父目录）
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  // 开启 WAL 提升并发读性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 执行建表 SQL
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  // 旧库 users.phone 带 NOT NULL 约束（短信登录时代遗留），匿名登录插入 phone=null 会 500
  // 检测到该约束时按新 schema 重建表并迁移数据
  const userInfo = db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string; notnull: number }>;
  const phoneCol = userInfo.find((c) => c.name === 'phone');
  if (phoneCol?.notnull) {
    const oldCols = userInfo.map((c) => c.name);
    const shared = ['id', 'phone', 'device_id', 'vip_activated_at', 'vip_code', 'free_used_count', 'chat_free_used_count', 'created_at'].filter((n) => oldCols.includes(n));
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE IF EXISTS users_new;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        device_id TEXT UNIQUE,
        vip_activated_at INTEGER,
        vip_code TEXT,
        free_used_count INTEGER DEFAULT 0,
        chat_free_used_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users_new (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
    console.log('[db] 已重建 users 表：移除 phone NOT NULL 旧约束');
  }

  // 兼容老库：补齐后续新增列（CREATE TABLE IF NOT EXISTS 不会改老表结构）
  const cols = db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('chat_free_used_count')) {
    db.exec(
      "ALTER TABLE users ADD COLUMN chat_free_used_count INTEGER DEFAULT 0"
    );
  }
  if (!colNames.has('device_id')) {
    db.exec("ALTER TABLE users ADD COLUMN device_id TEXT");
  }

  const vipCols = db.prepare("PRAGMA table_info('vip_codes')").all() as Array<{ name: string }>;
  const vipColNames = new Set(vipCols.map((c) => c.name));
  if (!vipColNames.has('device_id')) {
    db.exec("ALTER TABLE vip_codes ADD COLUMN device_id TEXT");
  }
  if (!vipColNames.has('wechat_id')) {
    db.exec("ALTER TABLE vip_codes ADD COLUMN wechat_id TEXT");
  }
  if (!vipColNames.has('amount')) {
    db.exec("ALTER TABLE vip_codes ADD COLUMN amount REAL");
  }

  const chatCols = db.prepare("PRAGMA table_info('chat_logs')").all() as Array<{ name: string }>;
  if (!chatCols.some((c) => c.name === 'references_json')) db.exec('ALTER TABLE chat_logs ADD COLUMN references_json TEXT');
  if (!chatCols.some((c) => c.name === 'kind')) db.exec("ALTER TABLE chat_logs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");

  const orderCols = db.prepare("PRAGMA table_info('orders')").all() as Array<{ name: string; notnull: number }>;
  const orderColNames = new Set(orderCols.map((c) => c.name));
  if (!orderColNames.has('wechat_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN wechat_id TEXT');
  }
  // 老库 amount 为 NOT NULL，改为可空（预生成码场景金额后补）
  const amountCol = orderCols.find((c) => c.name === 'amount');
  if (amountCol?.notnull) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE IF EXISTS orders_new;
      CREATE TABLE orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL,
        trade_no TEXT,
        wechat_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      INSERT INTO orders_new (id, user_id, amount, trade_no, wechat_id, status, created_at)
        SELECT id, user_id, amount, trade_no, NULL, status, created_at FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS unique_order_reference ON orders(trade_no) WHERE trade_no IS NOT NULL;
    `);
    db.pragma('foreign_keys = ON');
    console.log('[db] 已重建 orders 表：amount 改为可空，新增 wechat_id');
  }

  // 免费答题额度由「题数」改为「次数」：老库 users.free_used_count 存的是抽到的题数，
  // 直接沿用会把只抽过一套试卷（旧口径 10）的用户误判为额度用尽。发一套试卷必留一行
  // exam_sessions，故按试卷套数重算即为次数，且对新口径同样成立，可每次启动幂等校正。
  const recalculated = db.prepare(`
    UPDATE users SET free_used_count = (
      SELECT COUNT(*) FROM exam_sessions WHERE exam_sessions.user_id = users.id
    )
    WHERE vip_activated_at IS NULL
      AND free_used_count <> (
        SELECT COUNT(*) FROM exam_sessions WHERE exam_sessions.user_id = users.id
      )
  `).run();
  if (recalculated.changes > 0) {
    console.log(`[db] 已按「次」重算 ${recalculated.changes} 个用户的免费答题用量`);
  }

  // 如果题目表为空，尝试从 JSON 导入
  const countRow = db.prepare('SELECT COUNT(*) as c FROM questions').get() as { c: number };
  if (countRow.c === 0) {
    const dataPath = join(__dirname, '..', '..', 'data', 'questions.json');
    const imported = importQuestionsFromJson(db, dataPath);
    if (imported === 0) {
      console.warn('[db] 题库为空，且未找到 ../data/questions.json，请后续手动导入题目');
    } else {
      console.log(`[db] 已从 questions.json 导入 ${imported} 道题目`);
    }
  } else {
    console.log(`[db] 题库已有 ${countRow.c} 道题目`);
  }

  dbInstance = db;
  return db;
}

// 关闭数据库（用于测试或优雅关闭）
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export default getDb;
