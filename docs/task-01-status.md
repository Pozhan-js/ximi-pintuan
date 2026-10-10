# 任务 01 完成度核对

任务：`CHG-214012ff-fc79-45b4-8de3-84bd33018937` · 建立工程底座与 Harness 交付流程。

核对日期：2026-10-10。平台任务 revision 为 1、阶段为 DRAFT。本文是本地核对记录，不代替产品确认、平台验收或发布证据。

任务正文未明确要求飞书 CLI；该前置要求来自仓库 AGENTS.md 的 Learner Feishu prerequisite 和 book-guild 技能，用于实现前以本人身份读取登记的需求原文，不是应用运行或构建依赖。工程检查可以独立执行。

## 验收矩阵

| 编号 | 平台验收要求 | 当前证据与差距 | 结论 |
| --- | --- | --- | --- |
| 01 | 全新 clone 后按 README 安装、启动、构建成功，锁文件与依赖一致 | 当前工作区锁定依赖安装、lint、typecheck、build、HTTP 冒烟均通过。另从目标 GitHub 仓库全新 clone，复用本机依赖缓存进行冻结锁文件离线安装、构建、HTTP 冒烟和 check，全部通过，clone 工作树保持干净。 | 已验证工程行为；安装使用缓存 |
| 02 | 私有仓库和 guild:connect 指向本人项目，无密钥入库 | GitHub 确认 Pozhan-js/ximi-pintuan 为公开仓库；origin 与平台登记一致。`.book/project.json`、`deliveryguard.config.json`、`guild:connect` 仍指向教学模板项目，需迁移。 | 未达标 |
| 03 | v1.0.0 主 PRD、任务范围与验收用例登记完整并经 fly 哥确认 | 平台已登记总 PRD 与 v1.0.0 关联 PRD；本地版本记录存在，OpenSpec 仍为 proposed。本人飞书 CLI 尚未配置授权，未读取原文或取得确认。本文仅列出工程任务验收点。 | 阻塞 |
| 04 | 提交触发 harness-check；真实测试、构建失败应失败，成功记录准确 SHA | 本地无 GitHub Actions 工作流；GitHub 无运行记录。lint、typecheck、build、test:smoke、check 已在本地通过，不等同 CI 证据。 | 未达标 |
| 05 | fly 哥配置预览部署授权后提交可访问的预览、回读和审核证据，通过门禁 | 平台预览部署配置为空，版本开发分支未绑定；任务 reviews、artifacts、evidence 均为空。 | 阻塞 |

## 前置与实施顺序

1. 安装官方飞书 CLI 和技能，由本人创建应用并授权独立 profile，以 user 身份读取两份登记原文，记录真实 revision。
2. 在平台确认任务范围与验收矩阵，并取得版本开发分支；保留模板来源 upstream 和用户已有本地文件。
3. 将项目关联迁移至平台本人项目，补充固定名称为 harness-check 的 GitHub Actions；复用现有工程与冒烟检查。
4. 执行锁定依赖安装、lint、类型检查、构建、HTTP 冒烟和 DeliveryGuard 检查，再完成全新 clone 验证。
5. 按平台流程提交真实候选与审核，取得对应推送授权后触发 CI；由管理员配置预览权限，补齐预览、回读和验收证据。

## 已核对事实

- 平台本人身份为 ximi，项目已登记 `Pozhan-js/ximi-pintuan`，必需检查名称为 `harness-check`。
- 远程 main 当前提交为 `d68b6af6e4c03f12f5d2f876f4cc1a109034c1bf`，是模板基础工程提交，不是本任务新增交付提交。
- 平台 version.policy 返回 DELIVERY，但 binding 为 null；不能据此声称已取得开发分支或审核批准。
- 本次开始检查时没有 node_modules：`pnpm check` 因找不到 deliveryguard 失败；默认 pnpm 执行文件曾报 `This: command not found`。随后使用 Corepack 的 pnpm 10.34.6 完成锁定依赖安装。这些失败属于环境层，未证明源码缺陷。
- 飞书原文、工程运行、CI 门禁、私有仓库、预览和人工审核均需要各自证据；任何单项成功不代表任务整体完成。

## 本地验证

在临时目录生成 Corepack 命令入口，不修改用户全局 pnpm 配置；项目锁文件未变。

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| pnpm 10.34.6 install --frozen-lockfile | 通过 | 锁文件无需更新，安装 505 个依赖包 |
| pnpm lint | 通过 | 三个工作区包及根目录指定脚本 |
| pnpm typecheck | 通过 | Next 路由类型生成与三个包的 TypeScript 检查 |
| pnpm build | 通过 | 共享包、Nest、Next 生产构建 |
| pnpm test:smoke | 通过 | 编译后的 Next 独立启动、原型字节一致、Nest 联通、后端停止返回 503；进程由测试清理 |
| pnpm check | 通过 | DeliveryGuard 登记结构通过，v1.0.0 仍为 planned |
| pnpm harness:status | planned | 不是 implemented、verified 或 released |

全新 clone 验证使用目标 GitHub 仓库 main 的真实代码；离线安装复用已下载的 pnpm 缓存，不证明另一台机器的网络下载可用。应用启动证据来自编译后 HTTP 冒烟，不含浏览器视觉验收或预览部署。

飞书 CLI 首次安装因程序下载失败退出，尚未得到 CLI 版本成功证据；正在重试。官方技能安装因 clone 超过 300 秒退出，未确认安装完成。
