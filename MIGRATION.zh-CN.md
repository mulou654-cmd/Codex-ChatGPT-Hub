# Codex ChatGPT Hub 迁移到新电脑指南

这份文档用于把当前 MCP Hub 迁移到另一台电脑，让新电脑快速完成：

- Codex 本地 MCP 接入
- ChatGPT Connector 通过 ngrok 接入
- Paper / Hub / Session / Run 共享记忆恢复
- 本地 dashboard 与 HTTP MCP 服务启动

## 一句话流程

如果只想最快跑起来：

```bash
git clone <你的仓库地址> mcp
cd mcp
npm install
npm run build
npm run setup
npm run config -- install
npm run serve
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- start-watcher
```

然后在 ChatGPT Connector 里填 dashboard 显示的：

```text
https://你的-ngrok-url/mcp
```

认证方式选择：

```text
No Auth
```

详细点击路径和填写项见：[CHATGPT_CONNECTOR.zh-CN.md](./CHATGPT_CONNECTOR.zh-CN.md)。

## 迁移前先搞清楚两类数据

项目分两部分：

```text
mcp/
  src/                 # MCP 代码
  dist/                # build 后生成
  .env                 # 本机配置，不建议提交
  .data/               # 共享记忆、paper memory、session、run archive
```

如果你只 clone 代码，新电脑会是一个干净 Hub。

如果你想保留旧电脑上的任务、论文记忆、实验日志、run archive，需要把旧电脑的 `.data/` 一起迁移。

## 方式 A：新电脑从零开始

适合新用户，或者不需要旧记忆。

### 1. 安装 Node.js

需要 Node.js 20 或更高版本。

检查：

```bash
node -v
npm -v
```

### 2. 获取项目

```bash
git clone <你的仓库地址> mcp
cd mcp
```

如果不是用 git，也可以直接把整个项目文件夹复制到新电脑。

### 3. 安装依赖并构建

```bash
npm install
npm run build
```

### 4. 生成本机配置

```bash
npm run setup
```

它会生成：

```text
.env
.data/
codex-config.generated.toml
```

### 5. 自动注入 Codex MCP 配置

```bash
npm run config -- install
```

这个命令会把 MCP 配置写入：

```text
~/.codex/config.toml
```

它只管理下面这一段：

```toml
# BEGIN CODEX CHATGPT HUB MANAGED MCP
# END CODEX CHATGPT HUB MANAGED MCP
```

并且会自动备份原配置：

```text
~/.codex/config.toml.bak.<timestamp>
```

检查状态：

```bash
npm run config -- status
```

移除自动注入：

```bash
npm run config -- remove
```

### 6. 启动本地 HTTP MCP

```bash
npm run serve
```

检查：

```bash
npm run serve -- status
npm run doctor
```

打开 dashboard：

```text
http://127.0.0.1:3333/
```

## 方式 B：带旧电脑记忆迁移

适合保留已有 paper memory、session、run archive。

### 1. 在旧电脑打包 `.data`

在旧电脑项目目录：

```bash
cd /path/to/Codex-ChatGPT-Hub
tar -czf mcp-data-backup.tar.gz .data
```

把 `mcp-data-backup.tar.gz` 复制到新电脑。

### 2. 在新电脑恢复 `.data`

在新电脑项目目录：

```bash
cd mcp
tar -xzf /path/to/mcp-data-backup.tar.gz
```

确认：

```bash
ls .data
```

你应该能看到类似：

```text
hub-state.json
paper-state.json
session-state.json
runs/
```

### 3. 重新生成新电脑的 `.env`

不要直接照搬旧电脑 `.env`，因为路径可能不同。

推荐：

```bash
npm run setup
```

如果你已经恢复了 `.data`，`setup` 会继续使用当前项目下的 `.data`。

### 4. 重新注入 Codex 配置

```bash
npm run config -- install
```

然后重启 Codex，让它重新加载 MCP 配置。

## ngrok 接入

ChatGPT 官网不能访问你的本机 `127.0.0.1`，所以需要 ngrok 把本机 MCP 暴露成公网 HTTPS。

### 1. 获取 ngrok authtoken

打开：

```text
https://dashboard.ngrok.com/get-started/your-authtoken
```

复制你的 token。

### 2. 自动安装 / 检查 ngrok

```bash
npm run tunnel -- install
```

macOS 会优先尝试：

```bash
brew install ngrok
```

Linux 会输出官方 apt 安装命令。

Windows 推荐：


```text
https://ngrok.com/download/windows?tab=download
```

### 3. 配置 token 并启动 tunnel

```bash
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
```

它会自动完成：

- 配置 ngrok authtoken
- 确保本地 MCP 服务在线
- 启动 ngrok tunnel
- 读取公网 HTTPS URL
- 写入 `.env` 的 `MCP_HUB_PUBLIC_URL`
- 重启 HTTP MCP 让 dashboard 显示新 URL

检查：

```bash
npm run tunnel -- status
```

你会看到：

```text
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

### 4. 开启自动重连 watcher

```bash
npm run tunnel -- start-watcher
```

它会在后台检查：

- 本地 MCP 是否在线
- ngrok API 是否可访问
- 公网 URL 是否存在

如果发现断连，会自动重连并更新 `.env`。

停止 watcher：

```bash
npm run tunnel -- stop-watcher
```

停止 ngrok：

```bash
npm run tunnel -- stop
```

## ChatGPT Connector 设置

更详细的 ChatGPT 官网点击路径见：[CHATGPT_CONNECTOR.zh-CN.md](./CHATGPT_CONNECTOR.zh-CN.md)。

在 ChatGPT Connector 里：

```text
Server URL: https://xxxx.ngrok-free.dev/mcp
Authentication: No Auth
```

如果看到：

```text
This connection needs to be reauthenticated before ChatGPT can use it.
```

通常是 ngrok URL 变了。处理方式：

```bash
npm run tunnel -- start
```

然后把新的 Connector URL 填回 ChatGPT，点 Reconnect。

如果还不行，就 Disconnect 后重新添加。

## 常用命令

### 本地 MCP 服务

```bash
npm run serve
npm run serve -- status
npm run serve -- restart
npm run serve -- stop
npm run serve -- logs
```

### Codex 配置自动注入

```bash
npm run config -- status
npm run config -- install
npm run config -- remove
npm run config -- install --dry-run
```

### ngrok tunnel

```bash
npm run tunnel -- install
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- status
npm run tunnel -- start
npm run tunnel -- start-watcher
npm run tunnel -- stop-watcher
npm run tunnel -- stop
```

### 健康检查

```bash
npm run doctor
npm run tools
```

### 运行归档

```bash
npm run wrap -- -- npm run build
npm run wrap -- -- npm run typecheck
```

## 迁移后验收清单

### 1. 本地服务正常

```bash
npm run doctor
```

应该看到：

```text
HTTP service process OK
HTTP server health OK
```

### 2. Codex 配置已注入

```bash
npm run config -- status
```

应该看到：

```text
Installed: yes
Server name: codex-chatgpt-hub
```

### 3. ngrok 正常

```bash
npm run tunnel -- status
```

应该看到：

```text
ngrok installed: yes
ngrok running: yes
MCP health: ok
ngrok API: ok
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

### 4. ChatGPT 能看到工具

ChatGPT 里让它列 tools，应该能看到：

```text
hub_*
paper_*
session_*
run_*
profile_*
```

当前完整工具数量应该是：

```text
56
```

### 5. Dashboard 正常

打开：

```text
http://127.0.0.1:3333/
```

应该能看到中文控制台。

## 常见问题

### 端口 3333 被占用

检查：

```bash
npm run serve -- status
```

重启：

```bash
npm run serve -- restart
```

如果还是不行，可以换端口，编辑 `.env`：

```bash
MCP_HUB_HTTP_PORT="3334"
```

然后：

```bash
npm run serve -- restart
npm run tunnel -- start
```

### ChatGPT 连接失败

先检查：

```bash
npm run tunnel -- status
```

确认：

```text
MCP health: ok
ngrok API: ok
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

然后在 ChatGPT Connector 里重新填写这个 URL。

### Codex 看不到 MCP

执行：

```bash
npm run config -- install
```

然后重启 Codex。

### 新电脑没有旧论文记忆

说明没有迁移 `.data/`。

把旧电脑的 `.data/` 打包复制过来，再重启服务：

```bash
npm run serve -- restart
```

### Mac 休眠后断连

Mac 睡眠后本地 MCP 和 ngrok 都会断。

临时防睡眠：

```bash
caffeinate -dimsu
```

更推荐：

```bash
npm run tunnel -- start-watcher
```

但 watcher 也依赖电脑保持运行。

## 安全提醒

当前推荐为了方便使用：

```text
Authentication: No Auth
```

这意味着只要别人知道你的 ngrok URL，就可能访问这个 MCP。

建议：

- 不要公开分享 ngrok URL
- 不要把 `.env` 提交到 git
- 不要把密钥、账号、论文版权原文写进 Hub
- 长期使用时再补 OAuth 或 Bearer token 方案
