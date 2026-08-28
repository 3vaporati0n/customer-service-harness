# 客服功能验收数据库

本目录用于保存本地客服功能验收所需的 SQLite 文件。数据库、WAL、共享内存和重置备份均由命令自动生成并被 Git 忽略，不属于生产数据。

```bash
npx -y pnpm@11.7.0 run customer-service:db:init
npx -y pnpm@11.7.0 run customer-service:db:inspect
npx -y pnpm@11.7.0 run customer-service:db:reset
```

从 Git worktree 运行这些命令时，数据库仍会写入主项目的 `data/`，不会写入 `.worktrees/`。
