# ChatGPT Connector 设置指南

这份文档说明如何把 `codex-chatgpt-hub` 接到 ChatGPT 官网里。

## 1. 先确认本地服务和 ngrok 正常

在项目目录运行：

```bash
npm run serve -- status
npm run tunnel -- status
```

你需要看到类似：

```text
MCP health: ok
ngrok API: ok
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

记下 `Connector URL`。

## 2. 打开 ChatGPT Connector 设置

在 ChatGPT 官网：

1. 点击左下角头像 / 账户菜单。
2. 进入 `Settings`。
3. 找到 `Connectors`。
4. 点击 `Create`、`New App` 或 `Add custom connector`。

不同账号界面文字可能略有差异，核心是进入“自定义 Connector / 自定义 MCP server”的创建页面。

## 3. 填写 New App

建议这样填：

```text
Name: Codex ChatGPT Hub
Description: Codex 和 ChatGPT 共用的 MCP 协作中转站
Connection: Server URL
Server URL: https://xxxx.ngrok-free.dev/mcp
Authentication: No Auth
```

注意：

- `Server URL` 一定要以 `/mcp` 结尾。
- 如果你当前使用免费 ngrok，URL 可能会变化。
- 当前测试模式使用 `No Auth`，不要选择 OAuth。

## 4. 风险确认

ChatGPT 可能会显示：

```text
Custom MCP servers introduce risk
```

勾选：

```text
I understand and want to continue
```

然后点击：

```text
Create
```

再点击：

```text
Connect
```

如果出现授权页，也选择继续连接。

## 5. 测试是否成功

新开一个 ChatGPT 对话，问：

```text
请使用 Codex ChatGPT Hub 列出当前可用 tools。
```

正常应该能看到 `hub_*`、`paper_*`、`session_*`、`run_*`、`profile_*` 等工具。

也可以问：

```text
请调用 profile_overview 和 run_overview，确认 MCP Hub 当前状态。
```

## 6. 如果提示需要重新认证

如果看到：

```text
This connection needs to be reauthenticated before ChatGPT can use it.
```

通常是 ngrok URL 变了。

先在本地运行：

```bash
npm run tunnel -- start
npm run tunnel -- status
```

复制新的：

```text
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

然后回到 ChatGPT Connector：

1. 点击这个 Connector。
2. 点击 `Reconnect`。
3. 如果仍失败，点击 `Disconnect`。
4. 删除旧 Connector 或重新编辑 URL。
5. 用新的 `Connector URL` 重新创建 / 连接。

## 7. 推荐日常启动顺序

```bash
npm run serve
npm run tunnel -- start
npm run tunnel -- start-watcher
```

`start-watcher` 会后台检查 ngrok 和 MCP 状态，断了会自动重连。
