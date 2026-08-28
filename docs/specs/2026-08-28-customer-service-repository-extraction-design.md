# 客服模块独立仓库拆分设计

日期：2026-08-28
状态：已获用户设计批准

## 1. 目标

将当前 `deepseek harness` 仓库中的客服模块拆分为一个可独立开发、测试、打包和安装的本地 Git 仓库，并推送到私有 GitHub 仓库：

- 本地目录：`/Users/mac/Documents/ChatGPT/customer-service-harness`
- GitHub：`3vaporati0n/customer-service-harness`
- 默认分支：`main`
- 可见性：Private

拆分后，原仓库只保留 DeepSeek Harness 学习文档、验证脚本和非客服示例；新仓库承载全部客服源代码、客服文档与本地验收数据的运行位置。

## 2. 采用方案

采用“独立仓库、根目录扁平化”方案。现有 `examples/dsh-customer-service-suite/` 的内容提升为新仓库根目录，避免新仓库仍保留无意义的 `examples/` 包装层。

旧版客服查询基线 `examples/dsh-plugin-order-query/` 迁移至新仓库 `legacy/dsh-plugin-order-query/`，只用于兼容验证，不进入当前生产 Bundle。

不使用 Git 历史过滤或仓库历史重写。新仓库以当前已验证的完整客服快照作为首个提交；旧仓库历史仍能追溯此前客服开发过程。

## 3. 新仓库结构

```text
customer-service-harness/
├── packages/
├── plugins/
├── bundles/
├── legacy/
│   └── dsh-plugin-order-query/
├── scripts/
├── tests/
├── docs/
│   ├── module-map.md
│   ├── plans/
│   └── specs/
├── data/
│   └── README.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
└── README.md
```

`node_modules/`、`lib/`、`dist/`、`.DS_Store`、SQLite 文件、WAL/SHM 文件及数据库备份均不提交到 GitHub。

## 4. 迁移范围

### 4.1 迁入新仓库

- `examples/dsh-customer-service-suite/` 的全部受版本控制源文件。
- `examples/dsh-plugin-order-query/` 的全部受版本控制源文件，目标为 `legacy/dsh-plugin-order-query/`。
- 客服相关规格与计划，包括模块化客服套件、订单/物流/库存查询、SQLite 验收、测试数据录入、售后流程、订单到库存衔接和退款进度提醒。
- 当前尚未提交但已经完成验证的退款进度提醒插件与 Bundle 集成改动。
- `data/README.md`。
- 当前本地 `data/` 下的 SQLite 验收数据库和备份，仅迁移到新本地目录，不纳入 Git。

### 4.2 保留在旧仓库

- DeepSeek Harness 架构、源码原理和插件开发指南。
- `examples/dsh-plugin-beginner-greet/`。
- 与客服无关的研究资料、验证脚本和配置。
- 原 Git 历史。

### 4.3 从旧仓库移除

- `examples/dsh-customer-service-suite/`。
- `examples/dsh-plugin-order-query/`。
- 已迁移的客服专用规格和计划。
- 根 `package.json` 中 `customer-service:*` 命令；若移除后没有其他用途，则删除该根清单。
- 旧位置的本地 `data/` 客服数据库与备份，但必须在新位置完成数据校验后才删除。

## 5. 路径与运行契约

新仓库内所有命令都从仓库根目录执行：

```bash
npx -y pnpm@11.7.0 install --frozen-lockfile
npx -y pnpm@11.7.0 run verify
npx -y pnpm@11.7.0 run install:web
```

必须修改以下路径假设：

- 打包脚本中的旧版插件路径改为 `legacy/dsh-plugin-order-query`。
- 项目根目录解析不再依赖外层 `deepseek harness`。
- SQLite 验收数据库固定解析到新仓库 `data/customer-service.db`。
- 文档中的活动命令和活动路径更新为新仓库结构；历史说明可保留原始背景，但必须标明旧路径。

Web Profile 安装后必须指向新数据库绝对路径，不再引用旧仓库。

## 6. 数据迁移与安全

迁移前停止本地 Harness Web 进程，避免 SQLite WAL 在复制过程中继续变化。对数据库执行 checkpoint 或安全备份后，将数据库、WAL/SHM 和备份目录迁移到新仓库的 `data/`。

校验内容至少包括：

- 退款 `REFUND-5796C4B8-CF8F-44F4-A00E-89FC5386BB44` 仍存在。
- 金额为 `258`。
- 状态为 `processing`。
- 数据库能以只读模式打开。

只有在新位置验证成功并完成 Web Profile 重装后，才能删除旧位置数据。任何失败都保留旧数据，不执行清理。

## 7. Git 与 GitHub

新目录初始化为独立 Git 仓库，分支为 `main`。提交前检查：

- `git status` 不包含数据库、备份、依赖或构建产物。
- 无密钥、令牌和本机私密配置进入提交。
- 全量验证通过。

然后使用已登录的 GitHub 账号创建私有仓库 `3vaporati0n/customer-service-harness`，设置 `origin` 并推送 `main`。推送后通过 GitHub API/CLI 核对仓库为 Private、默认分支为 `main`、远程提交与本地 HEAD 一致。

旧仓库的清理作为独立提交执行，不向不存在的远程推送。

## 8. 验证标准

迁移完成必须同时满足：

1. 新仓库依赖可由锁文件安装。
2. TypeScript 全量构建通过。
3. 全量自动化测试通过，包含退款进度提醒测试。
4. 生产 Bundle 与演示 Bundle 验证通过。
5. 打包与 Web Profile 安装成功。
6. Web Profile dump-config 包含退款提醒节点且没有旧版重复插件。
7. SQLite 新路径中的既有数据完整。
8. 新 GitHub 私有仓库可访问，`main` 已推送。
9. 旧仓库工作树不再含客服源码或客服本地数据库。
10. `.DS_Store` 不进入任一提交。

## 9. 失败处理与回滚

- 新仓库创建或验证失败：不删除旧仓库中的任何客服文件或数据。
- GitHub 创建失败：保留已验证的新本地仓库，修复远程问题后重试。
- Web Profile 重装失败：保留旧数据库副本，并恢复旧 Profile 配置或重新安装旧 Bundle。
- 旧仓库清理前再次比较文件清单；发现未迁移文件则停止清理。
- 不使用 `git reset --hard`、`git checkout --` 或宽泛递归删除。

## 10. 非目标

- 不更改现有客服业务行为。
- 不新增客服功能。
- 不公开 GitHub 仓库。
- 不上传真实或验收 SQLite 数据。
- 不重写旧仓库历史。
