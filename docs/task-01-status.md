# 任务 01 完成度核对

任务：`CHG-214012ff-fc79-45b4-8de3-84bd33018937` · 建立工程底座与 Harness 交付流程。

核对日期：2026-10-10。平台任务 revision 为 1、阶段为 DRAFT。本文不代替平台审核、验收或发布。

本人已明确授权任务 01 先完成工程底座与 CI，原文读取与产品确认继续待办；业务实现仍遵守原有飞书前置规则。按本人选择保留 `codex/github-task-one-1010`，不删除 CLI 下载文件、不改写已有历史。

## 验收矩阵

| 编号 | 平台验收要求 | 当前状态 | 所需证据 |
| --- | --- | --- | --- |
| 01 | 全新 clone 后按 README 安装、启动、构建成功，锁文件与依赖一致 | 旧 main 的全新 clone 验证通过；本次候选的冻结安装、项目一致性、lint、typecheck、build、HTTP 冒烟与 check 已通过 | 当前候选对应的真实安装、构建、启动及测试结果 |
| 02 | 私有仓库和 guild:connect 指向本人项目，无密钥入库 | 本地项目配置及 guild:connect 已迁移至本人项目；GitHub 仓库仍公开 | 仓库私有性与本人项目核对；无敏感凭证提交 |
| 03 | v1.0.0 主 PRD、任务范围与验收用例登记完整并经 fly 哥确认 | 两份原始链接、唯一主 PRD、版本、工程 OpenSpec 和本表已登记；原文 revision 与 fly 哥确认缺失 | 本人读取原文、产品确认及完整业务验收矩阵；不能将工程矩阵当作业务验收 |
| 04 | 提交触发 harness-check，真实测试及构建失败时检查失败，成功记录准确 SHA | 工作流已实现，尚未提交和触发远程运行 | 新提交 SHA 对应的 GitHub Actions 成功结果；失败传播验证 |
| 05 | fly 哥配置预览部署授权后提交可访问的预览、回读与审核证据，通过门禁 | 平台预览配置为空，review、artifacts、evidence 仍无成功记录 | 管理员配置、真实预览 URL、回读、审核与门禁回执 |

## 工程范围

复用现有 Next.js、Nest.js 和共享合同，只补充本人项目关联、平台来源同步所需 version-manifest、登记一致性检查、GitHub Actions 和交付说明，不实现 PRD-01 业务或新增运行依赖。

本地 DeliveryGuard 项目 ID 使用符合其 schema 的 ximi-pintuan，平台项目使用真实 UUID；配置检查通过仓库名、项目名和平台连接核对关联。本地 DeliveryGuard 仓库标识为 app，平台对应仓库标识为 web，两者都指向本仓库。业务 v1.0.0 仍为 planned，OpenSpec 为 proposed，验收与发布为 pending；不会因工程 CI 通过而改变。

## 候选登记与门禁

旧 SHA `6582689e93f5f10a0e4d1b9a835af519556a6f55` 只增加 CLI 压缩包、解压目录和核对文档，不能作为本次工程补齐的候选。

登记时必须使用新提交的完整 40 位 SHA、对应分支及实际文件路径，每行一个。任务允许修改的范围不能替代提交文件列表。准备提交前可运行 `git diff --name-only`；提交后使用 `git diff-tree --no-commit-id --name-only -r HEAD` 取得该提交文件，使用 `git rev-parse HEAD` 取得 SHA。若平台要求累计提交范围，则以其指定的基线与候选执行 `git diff --name-only BASE HEAD`。

平台已将 v1.0.0 的 web 仓库绑定到 codex/github-task-one-1010。以下门禁缺口尚未解决：

- 任务 scopePaths 不含 `.book`，而本人项目迁移必须修改 `.book/project.json`；需要明确将该必要配置加入任务范围。
- 已有提交含范围外的 book-collaboration-cli.tar.gz 与 book-collaboration-cli 目录。若门禁检查累计分支提交，仍会因旧提交受阻；保留原分支不代表旧提交已获批准。
- GitHub 仓库仍公开，调整私有性尚未获得授权。
- 缺原文读取、产品确认、工程审核、预览部署授权与实际证据。

## 验证记录

上一轮对旧 main 执行了冻结安装、lint、类型检查、生产构建、HTTP 冒烟和 DeliveryGuard check，均通过；全新 GitHub clone 另执行了冻结离线安装、构建、HTTP 冒烟和 check，均通过。离线安装复用了本机缓存，不证明另一台机器的网络可用。

本次候选已通过冻结离线安装、项目一致性检查、lint、typecheck、生产构建、HTTP 冒烟和 DeliveryGuard check。初次 check 因直接使用平台 UUID 不符合本地 schema 失败；已将本地 ID 改为合法标识并复验通过，未修改 schema 或弱化校验。另故意注入错误平台项目 ID，确认断言非零退出且失败后不会继续运行，再恢复配置并验证通过。工作流 YAML 解析成功，git diff --check 通过。GitHub Actions 尚未运行，不填造 SHA、CI URL、预览 URL 或审核结果。飞书 CLI 两次安装均因程序下载失败，官方技能 clone 超过 300 秒失败；本任务按本人授权继续工程实现。

## 本次提交门禁结果

已对暂存的 11 个任务文件调用 commit.prepare（reviewStage: COMMIT）。平台返回 HTTP 409、COMMIT_SCOPE：代码超出任务登记范围，请先更新方案。候选包含必要的 .book/project.json，当前 scopePaths 缺少 .book。方案尚未成功登记，未生成新的 Git 提交 SHA，未推送。用户原有提交与下载文件未改动。
