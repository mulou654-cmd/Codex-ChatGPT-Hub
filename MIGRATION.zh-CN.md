# 新电脑迁移

新电脑迁移说明已经合并到完整说明书：

[MANUAL.zh-CN.md - 新电脑迁移](./MANUAL.zh-CN.md#9-新电脑迁移)

如果不需要旧记忆，最短流程：

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

如果要迁移旧任务、论文记忆、session 和 run archive，把旧电脑的 `.data/` 一起复制到新电脑项目目录，再执行：

```bash
npm run setup
npm run config -- install
npm run serve -- restart
```

如果你使用了 `MCP_HUB_MEMORY_SPACE`，迁移整个 `.data/` 会带上所有空间；只迁移单个项目时，复制 `.data/spaces/<space>/` 并在新电脑 `.env` 中设置同名空间。
