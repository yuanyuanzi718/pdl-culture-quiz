# 胖东来文化评估题库

基于《胖东来企业文化手册》的评估题库应用：刷题测试、AI 答疑（DeepSeek）、VIP 解锁（微信客服人工发码）。

## 技术栈

- **前端**：React 18 + Vite + Tailwind CSS + Zustand + React Router 7
- **后端**：Fastify 5 + TypeScript + better-sqlite3 + JWT（jose）
- **数据库**：SQLite（`server/data/pdl-culture.db`，首次启动自动建库迁移）

## 环境要求

- Node.js ≥ 22
- pnpm

## 本地启动

需要开两个终端，分别跑后端和前端。

**1. 后端（端口 3001）**

```bash
cd server
pnpm install        # 首次或依赖变更后
pnpm dev            # tsx watch 启动，改代码自动重启
```

**2. 前端（Vite 默认 5173）**

```bash
cd web
pnpm install
pnpm dev
```

**3. 访问**

浏览器打开 `http://localhost:5173`。开发模式下 Vite 自动把 `/api` 代理到 `127.0.0.1:3001`（见 `web/vite.config.ts`），无需额外配置。

## 常用脚本

### server/

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发模式（tsx watch，热重启） |
| `pnpm build` | 构建到 `dist/` |
| `pnpm start` | 运行构建产物 `node dist/index.js` |
| `pnpm test` | vitest 单元测试 |
| `pnpm typecheck` | TypeScript 类型检查 |

### web/

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发模式（Vite） |
| `pnpm build` | 类型检查 + 生产构建到 `dist/` |
| `pnpm preview` | 预览生产构建（带 `/pdltk/api` 代理） |

## 环境变量（server/.env）

- `ALIPAY_*`、`SMS_*`：留空即自动进 Mock 模式（支付/短信走本地 Mock，无需真实商户号）
- DeepSeek API Key：需填入才能使用 AI 对话功能

## 部署说明

生产环境部署到 `jinhui.space/pdltk/` 子路径：

- 前端构建 `base: '/pdltk/'`，Router `basename: '/pdltk'`，API baseURL `/pdltk/api`（均已配置好）
- 服务器升配、域名备案、Nginx 配置等完整步骤见 [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md)
