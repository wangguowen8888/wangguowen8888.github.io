# Cloudflare Worker 部署 /api/chat（Hono + D1，固定 gpt-5.2）

本方案用于 GitHub Pages（静态站）接入 AI 聊天：

- 前端请求：`POST https://xxxx.workers.dev/api/chat`（body: `{ "prompt": "..." }`）
- 后端 Worker：`scripts/chat-backend/hono-worker.js`
- Worker 固定模型：`gpt-5.2`（服务端拒绝其它 model）
- Worker 上游请求：`https://code.newcli.com/codex/v1/responses`
- 可选：D1 用于服务端限流与聊天记录（`chat_usage`、`chat_logs`）

## 0. 部署前自检（本地，不需要 Cloudflare 登录）

在仓库根目录执行（先 `npm install` 安装依赖）：

```bash
npm run chat-worker:types
npm run chat-worker:d1:migrations:list:local
npm run chat-worker:deploy:dry-run
```

说明：

- `chat-worker:types`：验证 `wrangler.toml` 能被 Wrangler 正常解析
- `chat-worker:d1:migrations:list:local`：确认迁移文件能被识别（本地 D1）
- `chat-worker:deploy:dry-run`：打包校验（不实际上传）

## 1. 准备 D1

1. 在 Cloudflare Dashboard 创建一个 D1 数据库（名字建议：`ai-chat`）
2. 打开 `scripts/chat-backend/wrangler.toml`
3. 把 `database_id` 换成你真实的 D1 id

文件位置：

- `scripts/chat-backend/wrangler.toml`

## 2. 应用 D1 迁移（建表）

在仓库根目录执行（确保已安装 wrangler / 或已 `npm install`）：

```bash
npm run chat-worker:d1:migrations:apply:remote
```

## 3. 设置密钥

在 Cloudflare Workers 环境里添加 secret：

```bash
wrangler secret put OPENAI_API_KEY
```

注意：不要把密钥提交到 Git 仓库。

## 4. （可选）配置 CORS 白名单

默认 `CHAT_ALLOWED_ORIGINS="*"`，见 `scripts/chat-backend/wrangler.toml`。

如果你要更严谨，可以改成逗号分隔白名单：

```toml
CHAT_ALLOWED_ORIGINS = "https://your-domain.com,https://another-domain.com"
```

## 5. 部署 Worker

```bash
npm run chat-worker:deploy
```

部署完成后访问类似：

`https://xxxx.workers.dev/api/chat`

## 6. 修改前端 endpoint

把 `assets/js/site-config.js` 里的：

- `chatApiEndpoint`

改成你的 Worker 地址，例如：

`https://xxxx.workers.dev/api/chat`

然后打开 `ai-chat/` 即可使用。
