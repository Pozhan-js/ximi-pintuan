# 任务 01 完成度核对

任务：`CHG-214012ff-fc79-45b4-8de3-84bd33018937` · 建立工程底座与 Harness 交付流程。

核对日期：2026-10-10。平台任务 revision 为 7、阶段为 DRAFT（本轮候选登记前回查）。本文不代替平台审核、验收或发布。

本人已明确授权任务 01 先完成工程底座与 CI，原文读取与产品确认继续待办；业务实现仍遵守原有飞书前置规则。按本人选择保留 `codex/github-task-one-1010`，不删除 CLI 下载文件、不改写已有历史。

## 验收矩阵

| 编号 | 平台验收要求 | 当前状态 | 所需证据 |
| --- | --- | --- | --- |
| 01 | 全新 clone 后按 README 安装、启动、构建成功，锁文件与依赖一致 | 旧 main 的全新 clone 验证通过；本次候选的冻结安装、项目一致性、lint、typecheck、build、HTTP 冒烟与 check 已通过 | 当前候选对应的真实安装、构建、启动及测试结果 |
| 02 | 私有仓库和 guild:connect 指向本人项目，无密钥入库 | 本地项目配置及 guild:connect 已迁移至本人项目；GitHub 仓库仍公开 | 仓库私有性与本人项目核对；无敏感凭证提交 |
| 03 | v1.0.0 主 PRD、任务范围与验收用例登记完整并经 fly 哥确认 | 两份原始链接、唯一主 PRD、版本、工程 OpenSpec 和本表已登记；旧候选已有 fly 哥 PRODUCT APPROVED，原文 revision 和业务用例覆盖仍缺证据 | 本人读取原文及完整业务验收矩阵；新候选需重新核对批准有效性 |
| 04 | 提交触发 harness-check，真实测试及构建失败时检查失败，成功记录准确 SHA | 已提交的工程 SHA 触发真实 CI，但因远程 .book 模板身份失败；本轮已在本地拆开校验并通过检查，尚未提交修复 | 修复提交 SHA 对应的 GitHub Actions 成功结果；失败传播验证 |
| 05 | fly 哥配置预览部署授权后提交可访问的预览、回读与审核证据，通过门禁 | 平台预览配置仍缺证据；旧候选 CODE 为 REJECTED，缺新候选研发批准及交付回执 | 管理员配置、真实预览 URL、回读、审核与门禁回执 |

## 工程范围

复用现有 Next.js、Nest.js 和共享合同，只补充本人项目关联、平台来源同步所需 version-manifest、登记一致性检查、GitHub Actions 和交付说明，不实现 PRD-01 业务或新增运行依赖。

本地 DeliveryGuard 项目 ID 使用符合其 schema 的 ximi-pintuan，平台项目使用真实 UUID。远程工程校验核对 origin 仓库名、guild:connect 与 manifest 项目编号、唯一主 PRD 及两份文档登记；不读取 .book。本地校验额外核对 .book 的 learner 身份、项目名、项目编号、站点和完整仓库名。本地 DeliveryGuard 仓库标识为 app，平台对应仓库标识为 web，两者都指向本仓库。业务 v1.0.0 仍为 planned，OpenSpec 为 proposed，验收与发布为 pending；不会因工程 CI 通过而改变。

## 候选登记与门禁

旧 SHA `6582689e93f5f10a0e4d1b9a835af519556a6f55` 只增加 CLI 压缩包、解压目录和核对文档，不能作为本次工程补齐的候选。

登记时必须使用新提交的完整 40 位 SHA、对应分支及实际文件路径，每行一个。任务允许修改的范围不能替代提交文件列表。准备提交前可运行 `git diff --name-only`；提交后使用 `git diff-tree --no-commit-id --name-only -r HEAD` 取得该提交文件，使用 `git rev-parse HEAD` 取得 SHA。若平台要求累计提交范围，则以其指定的基线与候选执行 `git diff --name-only BASE HEAD`。

平台已将 v1.0.0 的 web 仓库绑定到 codex/github-task-one-1010。以下门禁缺口尚未解决：

- 任务 scopePaths 不含 `.book`；按本人最新要求，.book 修改只保留在本地，不进入本轮修复提交或远程 CI，因此本轮不要求增加该范围。
- 已有提交含范围外的 book-collaboration-cli.tar.gz 与 book-collaboration-cli 目录。若门禁检查累计分支提交，仍会因旧提交受阻；保留原分支不代表旧提交已获批准。
- GitHub 仓库仍公开，调整私有性尚未获得授权。
- 原文读取、完整业务验收、工程审核、预览部署授权与实际证据仍缺失。回查旧候选已有 fly 哥产品批准，但不代表本轮新代码候选获研发批准。

## 验证记录

上一轮对旧 main 执行了冻结安装、lint、类型检查、生产构建、HTTP 冒烟和 DeliveryGuard check，均通过；全新 GitHub clone 另执行了冻结离线安装、构建、HTTP 冒烟和 check，均通过。离线安装复用了本机缓存，不证明另一台机器的网络可用。

原工程补齐已通过冻结离线安装、项目一致性检查、lint、typecheck、生产构建、HTTP 冒烟和 DeliveryGuard check。初次 check 因直接使用平台 UUID 不符合本地 schema 失败；已将本地 ID 改为合法标识并复验通过，未修改 schema。飞书 CLI 两次安装均因程序下载失败，官方技能 clone 超过 300 秒失败；本任务按本人授权继续工程实现。

真实工程提交为 `3c69f557dfa9f23da14376d2f5b32321577ac434`。[GitHub CI](https://github.com/Pozhan-js/ximi-pintuan/actions/runs/38038173591) 第二次尝试仍因远程 .book 的 teaching-template 与 learner 不符而失败，后续构建与冒烟被跳过；不能将本地通过视为该远程提交已通过。

本轮在隔离目录先复现缺少 .book 时原脚本 ENOENT 失败，再拆开远程与本地校验。新增回归检查覆盖 .book 缺失、模板身份、错误项目编号、非法 JSON，以及 manifest 项目错误、主 PRD 登记漂移。CI 模式不受 .book 影响，本地模式遇到错误必须失败；登记漂移仍令 CI 模式非零退出。修复已通过冻结离线安装、项目与本地 Book 校验、lint、typecheck、build、HTTP 冒烟和 DeliveryGuard check，不新增依赖。按本人最新要求撤回 package.json 的本轮修改，保留既定指令；回归测试由 workflow 直接执行，本地使用 node scripts/check-project.mjs --local。

## 本次提交门禁结果

历史首次候选含 .book，commit.prepare 返回 HTTP 409、COMMIT_SCOPE。随后按本人要求排除 .book 的工程候选已登记，用户提交并推送了上述真实工程 SHA，但 CI 失败。

本轮修改只准备范围内的工程检查、回归测试和说明文件，保留本地 .book 修改且不暂存它。新候选仍须人工研发审核与本人提交回执；当前尚未提交或推送本轮修复，没有新的完整提交 SHA。候选登记不是审批、远程 CI 成功或发布证明。
