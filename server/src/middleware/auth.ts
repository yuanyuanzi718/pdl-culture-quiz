// 简易 JWT 认证（手机号注册/登录）
import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config.js';
import type { JwtPayload } from '../types.js';

const encoder = new TextEncoder();
const secret = encoder.encode(config.jwtSecret);
const ISSUER = 'pdl-culture-quiz';
const AUDIENCE = 'pdl-candidate';

// 为 request 增加 user 属性（声明合并）
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

// 签发 JWT
export async function signToken(userId: number, _phone?: string | null): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('30d')
    .sign(secret);
}

// 从请求头解析并验证 JWT，失败抛错
async function extractUser(request: FastifyRequest): Promise<JwtPayload | null> {
  const header = request.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], secret, { issuer: ISSUER, audience: AUDIENCE });
    if (!Number.isSafeInteger(payload.userId) || Number(payload.userId) <= 0) return null;
    return { userId: payload.userId as number };
  } catch {
    return null;
  }
}

// Fastify preHandler：要求携带有效 JWT，否则 401
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await extractUser(request);
  if (!user) {
    reply.code(401).send({ ok: false, error: '未授权或登录已过期' });
    return;
  }
  request.user = user;
}

// 可选认证：有 token 就解析，无 token 也放行（用于部分公共接口）
export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const user = await extractUser(request);
  if (user) request.user = user;
}
