# 拼团实战项目

独立的教学 monorepo：先用 Next.js 开发页面，后续接入 Nest.js 服务；共享类型放在独立包中。使用公开 npm 包 deliveryguard@0.5.0 管理交付记录。

从[课程实战路线](https://flyger.xyz/collaboration/routes)领取个人项目。平台生成个人仓库时会更新 `.book/project.json` 中的项目关联；该文件不包含凭证。

## 开始

业务实现前需要完成 [飞书 CLI 接入](docs/feishu-cli-setup.md)：配置自己的应用并以本人用户身份读取主 PRD 和版本原文。任务 01 经本人明确授权，先完成工程底座与 CI；原文读取和 fly 哥确认仍是待完成项。运行下面的工程示例无需飞书凭证。

使用 Node 22.19+（22.x）或 Node 24+；推荐按 `.nvmrc` 使用 Node 22.22.2。包管理器固定为 pnpm 10.34.6。已安装该版本时可跳过 Corepack 准备：

```sh
corepack enable
corepack prepare pnpm@10.34.6 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm harness:status
pnpm dev
```

打开 `http://localhost:3000`，可看到教学起点和原型入口；不启动 Nest.js 也能使用。开始业务任务前完成上述飞书接入，然后运行 `pnpm guild:connect`，本人登录网站核对终端指纹并确认；只有返回 online:true 才算连接成功。凭证保存在用户私有目录，不进入仓库。

## 项目结构与学习顺序

```text
packages/
  web/        Next.js 页面及 BFF（第一阶段）
  server/     Nest.js 服务（第二阶段）
  contracts/  前后端共享类型与纯函数
docs/
  product/    产品需求入口
  design/     HTML 原型与工程设计
```

第一阶段用 `pnpm dev` 单独运行 Next.js。第二阶段用 `pnpm dev:full` 同时运行 Next.js（3000）和 Nest.js（3001），通过 Next 的 `/api/server-health` 调用 Nest 的 `/api/health`，学习前后端联通。业务页面、权限、数据库和订单流程按后续任务实现。

构建与检查：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test:smoke`、`pnpm check`。更详细的启动、端口和包边界说明见 [monorepo 设计](docs/design/monorepo.md)。

`pnpm test:project` 检查已提交的工程配置、origin 仓库名、平台项目编号和两份需求登记是否一致，不读取 `.book`。`node scripts/check-project.mjs --local` 额外校验本地 `.book/project.json` 中的本人身份、项目、站点和完整仓库关联；本次 `.book` 修改保留在本地，不提交。既定 package.json 指令保持已提交内容，workflow 直接执行 `node --test scripts/check-project.test.mjs` 运行回归检查。GitHub Actions 在 main、codex 分支推送及面向 main 的 PR 上运行，job 名称为 `harness-check`；依次执行工程配置核对、lint、类型检查、真实构建、HTTP 冒烟及 DeliveryGuard 检查，任一步失败都会令检查失败，并在摘要记录事件 SHA。PR 事件 SHA 对应 GitHub 测试合并提交，push 事件对应推送提交。

本人仓库为 [Pozhan-js/ximi-pintuan](https://github.com/Pozhan-js/ximi-pintuan)，项目关联已写入配置；仓库私有性、平台审核、预览部署和验收各自需要真实证据。工程 CI 不代替平台审批门禁。任务验收矩阵与限制见 [任务 01 核对表](docs/task-01-status.md)。

## 当前边界

已搭建 Next.js、Nest.js 和共享包的基础工程，已登记拼团哇 v1.0.0 产品需求，OpenSpec 为 proposed；尚无业务实现、版本验收或生产交付记录。首页和健康接口属于工程示例，HTML 属于模拟原型；check 通过仅代表登记结构有效。

公开教学模板：[fly-ai-academy/pintuan-practice](https://github.com/fly-ai-academy/pintuan-practice)，默认分支 main。无需 GitHub 仓库邀请即可查看模板与 `docs/design` 中的原型。模板内容公开；本仓库尚需按任务要求调整为私有。

学员从[课程实战路线](https://flyger.xyz/collaboration/routes)创建个人项目，连接本人 GitHub 后领取独立私有仓库。平台会自动将 `.book/project.json`、`deliveryguard.config.json` 和 `guild:connect` 中的项目编号替换为个人项目；克隆准备页提供的个人仓库地址，再运行上述 pnpm 命令。不要直接在教学模板中连接教师项目，不共用教师设备凭证。

手动复制模板时，需要自行替换上述项目关联，并在平台登记准确的个人仓库、版本与需求后再执行 `guild:sync`。不要将 Book 平台仓库设置为本项目 origin。模板同步只影响之后创建的仓库，已有学员仓库保持各自的代码和进度。

## 产品需求

[拼团哇 PRD 与原型目录](docs/product/README.md)。仅登记总文档与 PRD-01「团长创建与发布拼团」；v1.0.0 只覆盖创建与发布，其他阶段暂不纳入。
