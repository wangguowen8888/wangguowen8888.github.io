# Cloudflare Worker 部署 /api/chat（固定 gpt-5.2）（新版：Hono + D1，见 `README-cloudflare-worker-hono-d1.md`）

> 说明：本文件为旧版入口文档，已升级到 Hono + D1 版本，请优先使用 `README-cloudflare-worker-hono-d1.md`。

本方案用于 GitHub Pages（静态站）接入 AI 聊天：

- 前端只请求：`chatApiEndpoint`
- 后端部署到 Cloudflare Worker：`POST /api/chat`
- Worker 固定模型：`gpt-5.2`，拒绝其它模型（服务端强制）
- Worker 由后端请求：`https://code.newcli.com/codex/v1/responses`

## 1. 设置密钥

在 Cloudflare 的 Workers 环境里添加 secret：

- `OPENAI_API_KEY`

注意：不要把密钥提交到 Git 仓库。

## 2. 部署（wrangler）

在项目里安装 wrangler（本地仅用于部署，不必在运行时常驻）：

```bash
npm i -g wrangler
```

然后创建一个 worker（你也可以用现有项目初始化）：

```bash
wrangler init
```

把 worker 的入口文件内容替换为：

- `scripts/chat-backend/cloudflare-worker.js`

并在 `wrangler.toml` 里声明 secret（示例）：

```toml
[vars]
#

[secrets]
OPENAI_API_KEY = "填你的值"
```

最后部署：

```bash
wrangler deploy
```

部署完成后你会得到类似：
`https://xxxx.workers.dev/api/chat`

## 3. 修改前端 endpoint

把 `assets/js/site-config.js` 里的：

- `chatApiEndpoint`

改成你的 worker 地址，例如：
`https://xxxx.workers.dev/api/chat`

然后在浏览器打开 `ai-chat/` 即可。
