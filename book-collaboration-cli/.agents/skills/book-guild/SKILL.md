---
name: book-guild
description: 在 book 实战项目中以学员本人身份连接 Codex、接手管理员分配的任务，并提交实现、验证和交付证据。
---

# 学员实战协作

## 本人上号

1. 在实战仓库核对适用 AGENTS.md、origin、当前分支和工作区；保留所有无关改动。使用仓库提供的 `scripts/book-collaboration/cli.mjs`，Node 22+。
2. 从本站项目页“连接 Codex”取得站点和项目编号。运行 `node scripts/book-collaboration/cli.mjs up --site <本站 HTTPS origin> --project <项目编号>`。不得使用 Wayi、公用账号或他人的凭证。
   学员已有个人仓库时，先在本人的个人准备页连接 GitHub、授权课程 App 访问该仓库并完成“绑定已有仓库”。不得将学员仓库登记到教师团队项目。模板里的 `guild:connect` 可能仍指向教师项目，应以个人准备页的项目号为准。
   已误连教师项目时，核对仓库已绑定本人个人项目后，可按准备页指令使用新版 CLI 的显式 `--switch-project --configure-project`。这两个选项是请求切换绑定和修复本地连接配置的授权；目标验证失败、配置脏文件或越界时停止，不自动覆盖。成功时保留旧绑定和配置备份，清除旧任务绑定；不修改业务代码，不自动切分支、提交或推送。旧 CLI 不支持时先更新课程提供的 CLI 文件，不使用删除 `.git` 或覆盖凭证的方式修复。
3. 初次上号会输出网站链接和指纹。请学员本人登录本站、核对终端和页面指纹并确认连接。Agent 不替本人点击确认，不读取或转发凭证。
4. 等待真实心跳结果。`online: true` 才表示已上号；网页确认本身不是成功。后台心跳每 15 秒发送一次，休眠/断网后可能离线。重复 up 不自动切分支。用 `status` 核对，用 `down` 下号。
5. 凭证仅保存在 `~/.book-collaboration/` 的私有目录中，按站点、项目和 worktree 隔离；不要读取、打印或写入仓库。

用户要求“同步项目”时，在已上号的实战仓库运行 `node scripts/book-collaboration/cli.mjs sync-sources`。只读取受 Git 跟踪的 version-manifest.json、登记文档、Repair 与未归档 OpenSpec；manifest.project 必须等于项目编号。冲突保留云端现状，不能用源状态冒充审核/验收。

## 旧连接与已完成代码的恢复

- 先保留工作区代码、已有 commit、分支和 origin。连接旧教师团队导致提交失败时，不能删除 `.git`、重写提交、把个人仓库登记到教师团队，或放宽目录权限。
- 从 `/collaboration/routes?fromProject=<旧项目编号>` 进入本人个人练习项目；已有个人仓库先在个人准备页授权课程 GitHub App 并完成绑定。使用该个人页提供的项目号和命令，显式执行 `up --switch-project --configure-project`。这一步只修复连接和必要配置，不改变代码、提交或审核结论。
- 恢复连接后，首次提交前先运行 `node scripts/book-collaboration/cli.mjs preview-commit --commit <完整40位SHA> --change <本人的目标CHG-ID>`。它只读取快照与版本策略，不发心跳、不申请候选、不保存配置、不输出 patch。检查 `ready`、`problems`、`warnings` 和具体超范围路径；不同分支不自动切换，未绑定分支需本人按任务指引处理。
- 多任务整包的历史提交不能隐式归入单个作业；超出 `scopePaths` 时保留历史提交，按任务合同讨论拆分或单独关联。页面关联旧任务作为参考，不等于通过候选审核、验收或门禁。
- 团队项目缺仓库或目录策略时由团队负责人核对；个人项目缺策略初始化时由课程教师核对。Agent 不自动授予宽目录权限。只读预检目前不重建合并提交，避免生成 Git 对象；合并审核仍走明确的合并协议。

## 接手与实现

1. 接手前先确认学员本人已授权飞书 CLI，并用 `read-prds --profile <本人飞书配置>` 读取当前版本的主 PRD 与关联 PRD。`show <CHG-ID> --profile <本人飞书配置>`、`bind <CHG-ID> --profile <本人飞书配置>` 同样会读取飞书原文。使用真实正文与 revision；无权限或读取失败时先解决本人授权或文档访问问题，不回退到站内副本，不使用老师的凭证。网页登记链接不代表已经读取。
2. 只在返回的版本开发分支或探索分支工作；不自动覆盖、stash、rebase 或切走脏工作区。探索不能用于发布；由项目管理员在网站转为正式交付。
3. 使用 `progress IMPLEMENTING --note "真实进展"`、`progress VERIFYING --note "验证情况"` 上报阶段。`task --file <JSON>` 仅在用户授权登记/更新任务时使用稳定 taskKey，更新时保留当前 revision。
4. PRD 以版本登记的飞书原文链接为准；旧站内修订不能当作飞书 revision。`readback --file <JSON>` 只提交实现事实、差异及建议；产品本人在网页逐条判定和确认，Agent 不代批。平台尚未核验飞书修订时，不能声称正式文档对齐或放行发布。

## 提交与验证

- 先完成范围内本地实现与检查。提交/推送仍分别需要用户授权。
- `preview-commit --commit <完整SHA> [--change <CHG-ID>]` 只读预检已存在提交的目标任务、范围、Git 身份和分支；`ready: true` 仍不代表审核通过。
- `prepare-commit` 上传精确暂存区方案和完整文本差异；`prepare-commit --commit <SHA>` 对已提交代码申请审核。网站人工批准后才能走相应门禁。
- `install-hooks` 只在用户要求接入门禁时运行，不覆盖既有 Hook。已有 Hook 按接入文档整合。不得使用 `--no-verify` 绕过；CI 还会复核真实提交、任务和回执。
- `artifacts --base <完整 SHA>` 从干净工作区登记真实提交；`run-check -- <命令> <参数>` 执行检查并上报本地证据，失败不得改成成功。
- GitHub CI 使用独立 CI 连接。`evidence-ci` 由服务端回查登记的必需检查；不能通过本地 JSON 伪造可信 CI 成功。
- `version-sync` 会查询 GitHub 默认分支并可能封版，只有用户授权登记/收口时运行。
- 通用 `request <action> --file <JSON>` 仍受服务端身份、任务、版本、revision 和审核约束，不能用于绕过网页人工审批。

## 交接

区分本地实现、提交、推送、检查、审核、合入、预览和生产发布。缺少平台配置、迁移或真实证据时如实报告，不填演示数据。站内待办由业务事务创建，本 Skill 不授权发送邮件或其他站外消息。
