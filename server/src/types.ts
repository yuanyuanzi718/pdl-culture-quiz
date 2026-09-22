// 共享类型定义

// 用户实体（API 响应格式，驼峰命名，与前端约定一致）
export interface User {
  id: number;
  deviceId: string | null;
  vipActivatedAt: number | null;
  vipCode: string | null;
  freeUsedCount: number;
  chatFreeUsedCount: number;
  isLocked: boolean;
  isChatLocked: boolean;
  freeExamLimit: number;
  examQuestionsPerRound: number;
  chatFreeLimit: number;
  createdAt: number;
}

// 题目实体
export interface Question {
  id: number;
  type: 'single' | 'multi' | 'judge';
  stem: string;
  options: string[]; // JSON 数组解析后
  answer: string; // 单选/判断: 字母如 "A"; 多选: 字母数组 JSON 字符串如 "[\"A\",\"B\"]"
  explanation: string | null;
  source: string | null;
  tags: string[] | null;
}

// 考试记录
export interface ExamRecord {
  id: number;
  user_id: number;
  score: number;
  question_ids: number[];
  answers: Record<string, string>; // {questionId: userAnswer}
  created_at: number;
}

// 聊天日志
export interface ChatLog {
  id: number;
  user_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

// VIP 码
export interface VipCode {
  code: string;
  status: 'available' | 'sent' | 'used';
  user_id: number | null;
  order_id: number | null;
  device_id: string | null;
  sent_at: number | null;
  activated_at: number | null;
  created_at: number;
}

// 订单
export interface Order {
  id: number;
  user_id: number;
  amount: number;
  trade_no: string | null;
  status: 'pending' | 'paid' | 'failed';
  created_at: number;
}

// 题目类型字面量
export type QuestionType = 'single' | 'multi' | 'judge';

// 用户答题负载
export interface ExamSubmitPayload {
  userId: number;
  questionIds: number[];
  answers: Record<string, string>;
}

// 聊天负载
export interface ChatPayload {
  userId: number;
  message: string;
}

// VIP 激活负载
export interface VipActivatePayload {
  userId: number;
  code: string;
  deviceId: string;
}

// 支付创建负载
export interface PaymentCreatePayload {
  userId: number;
}

// RAG 检索片段
export interface RagSnippet {
  text: string;
  source: string;
}

// RAG 检索结果
export interface RagResult {
  snippets: RagSnippet[];
  prompt: string;
}

// DeepSeek 调用结果
export interface DeepSeekResult {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// API 响应包装
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// JWT 载荷
export interface JwtPayload {
  userId: number;
}
