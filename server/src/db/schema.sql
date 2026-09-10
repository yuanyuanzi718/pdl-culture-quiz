-- 胖东来文化评估题库建表 SQL

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,                  -- 兼容历史字段，匿名用户不生成虚构手机号
  device_id TEXT UNIQUE,              -- 设备唯一标识（前端 localStorage UUID）
  vip_activated_at INTEGER,          -- null 表示未激活
  vip_code TEXT,
  free_used_count INTEGER DEFAULT 0,  -- 累计免费答题数（抽题+交卷计费）
  chat_free_used_count INTEGER DEFAULT 0,  -- 累计免费对话次数（独立计数）
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                -- 'single'|'multi'|'judge'
  stem TEXT NOT NULL,
  options TEXT NOT NULL,             -- JSON 数组
  answer TEXT NOT NULL,              -- 单选/判断: 字母; 多选: 字母数组 JSON
  explanation TEXT,
  source TEXT,                       -- 来源标注：幸福生命手册/企业介绍/题库
  tags TEXT                          -- JSON 数组
);

CREATE TABLE IF NOT EXISTS exam_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL,            -- 0-100
  question_ids TEXT NOT NULL,        -- JSON 数组
  answers TEXT NOT NULL,             -- JSON: {questionId: userAnswer}
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,                -- 'user'|'assistant'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS vip_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL,              -- 'available'|'sent'|'used'
  user_id INTEGER,                   -- 激活后绑定的用户
  order_id INTEGER,                  -- 兼容历史字段，新发码不再写入
  device_id TEXT,                    -- 激活时绑定的设备 ID
  wechat_id TEXT,                    -- 登记时的买家微信号（付费用户填写，赠送留空）
  amount REAL,                       -- 登记时的交易金额（付费用户填写，赠送留空）
  sent_at INTEGER,
  activated_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  trade_no TEXT,
  status TEXT NOT NULL,              -- 'pending'|'paid'|'failed'
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_exam_records_user ON exam_records(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_user ON chat_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_vip_codes_user ON vip_codes(user_id);

CREATE TABLE IF NOT EXISTS exam_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  questions TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_exam ON exam_sessions(user_id) WHERE submitted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_order_reference ON orders(trade_no) WHERE trade_no IS NOT NULL;
