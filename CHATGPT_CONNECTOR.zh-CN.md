# ChatGPT Connector 设置

ChatGPT Connector 的详细设置已经合并到完整说明书：

[MANUAL.zh-CN.md - 接入 ChatGPT Connector](./MANUAL.zh-CN.md#8-接入-chatgpt-connector)

最短流程：

```bash
npm run serve
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- status
```

然后把输出里的 Connector URL 填到 ChatGPT Connector：

```text
https://xxxx.ngrok-free.dev/mcp
```

认证方式选择：

```text
No Auth
```
