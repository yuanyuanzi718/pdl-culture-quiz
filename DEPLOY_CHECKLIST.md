# 生产部署清单

状态：云端部署已完成，验收通过。

## 发布范围

生产前端统一使用 `/pdl-tiku/`，API地址为 `/pdl-tiku/api/`。后端监听 `172.20.0.1:3001`（Docker 网络），反向代理将API路径转换为 `/api/`。当前商业流程是微信人工核实收款后由管理员发码，未接入支付宝自动支付或短信。

本地SQLite只用于开发和验收，包含历史访问记录。首次上线从273道题的JSON初始化全新数据库，不复制本地用户、订单、激活码、答题记录或聊天记录。后续升级保留生产数据库。

## 构建和准备发布包

在项目根目录执行，使用Node.js 22：

```sh
pnpm --dir server install --frozen-lockfile
pnpm --dir web install --frozen-lockfile
pnpm --dir server test
pnpm --dir server run typecheck
pnpm --dir server build
pnpm --dir web build
node scripts/prepare-release.mjs
```

输出为 `output/release-时间/`，附SHA256清单。发布包仅包括构建产物、服务端生产依赖清单、数据库结构、题库JSON及空的配置模板。不得上传工作区的 `node_modules`、`.env`、SQLite文件、测试目录或备份。

## 服务端配置

将发布包放在确定的项目目录，例如 `/opt/projects/pdltk`，在服务器上创建 `server/.env`，权限设为600。

- `NODE_ENV=production` 由启动命令设置。
- `JWT_SECRET`、`ADMIN_TOKEN`：分别生成至少32位随机值，禁止沿用旧默认值。启动会校验。
- `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`：填写已实际验证的服务配置；生产缺失时禁止启动。`DEEPSEEK_BASE_URL` 默认官方地址，可带或不带 `/v1`。
- `DATABASE_PATH=/opt/projects/pdltk/data/pdl-culture.db`：持久化路径，目录由服务用户可读写。
- `HOST=127.0.0.1`、`PORT=3001`、`FREE_QUESTION_LIMIT=3`、`FREE_CHAT_LIMIT=10`、`VIP_PRICE=9.9`、`VIP_CODE_VALID_HOURS=24`。
- 价格目前前端文案为9.9元；调整价格时必须同步前端并重新构建。

在服务器安装目标平台的生产依赖，不从macOS复制原生模块：

```sh
cd /opt/projects/pdltk/server
pnpm install --prod --frozen-lockfile
NODE_ENV=production node dist/index.js
```

验证启动后再配置现有进程管理器，工作目录必须是 `server`。当前后端 `build` 会生成 `dist/index.js`，`start` 使用Node运行编译产物，不依赖开发工具tsx。发布包必须保留 `server/src/db/schema.sql` 和 `server/data/questions.json`。

## 反向代理

在既有HTTPS站点内合并以下Nginx位置配置，勿覆盖服务器上的其他项目。实际域名和证书使用经过确认的值。

```nginx
location = /pdl-tiku { return 301 /pdl-tiku/; }
location /pdl-tiku/api/ {
    proxy_pass http://172.20.0.1:3001/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
location /pdl-tiku/ {
    alias /opt/projects/pdltk/web/dist/;
    index index.html;
    try_files $uri $uri/ /pdl-tiku/index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
```

反向代理由主机 nginx（8080）处理，Caddy（Docker :80）将 `/pdl-tiku/*` 转发至 nginx。首次部署前确认域名、备案、HTTPS 和端口实际状态。

## 上线验收及回退

- [x] 用户完成本地复测
- [x] 云端强随机密钥、AI配置、持久化路径已落实
- [x] 生产依赖在Linux上安装成功，服务进程持续运行
- [x] `/pdl-tiku/`、`/pdl-tiku/exam`、`/pdl-tiku/chat`、`/pdl-tiku/me`、`/pdl-tiku/admin` 可直接访问并刷新
- [x] `/pdl-tiku/api/health` 返回200，正常抽题、交卷、AI调用、管理端访问通过
- [x] 旧 `/api/payment/alipay/*` 和 `/api/sms/send` 返回404
- [x] 首次启动只有题库数据，没有本地测试账户、订单或激活码
- [ ] 生产SQLite在线备份和恢复路径落实；备份包含WAL一致性，不能只复制运行中的主文件
- [ ] 升级前保存旧发布目录及一致性数据库备份；失败时恢复旧发布，必要时恢复对应数据库

云端真实支付收款核对、公网HTTPS、代理限流地址和Linux原生依赖，只能在部署阶段最终确认。
