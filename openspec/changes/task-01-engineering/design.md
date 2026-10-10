# 实现方案

将 deliveryguard.config.json、version-manifest.json 与 guild:connect 关联至平台本人项目，version-manifest.json 仅登记真实原始文档链接，不填写未获取的 revision。.book/project.json 保留本人本地关联，按本人要求不纳入本次提交。

使用现有 pnpm workspace 的构建顺序与 HTTP 冒烟，按本人要求保留 package.json 的已提交内容，不新增或修改既定指令。pnpm test:project 只核对已提交的工程配置、origin、平台项目与唯一主 PRD 登记，不读取 .book；缺失或仍为模板的 .book 不影响 CI。node scripts/check-project.mjs --local 额外核对 .book 中的 learner 身份、平台项目、项目名、站点和完整仓库关联，错误必须失败。回归检查使用隔离目录，覆盖两种模式及版本登记漂移，workflow 直接通过 node --test 执行。

harness-check 对 main、codex 分支推送和面向 main 的 PR 运行；只授予 contents:read，官方 Actions 固定实际版本 SHA，依赖冻结安装。每一步使用正常失败退出，不设置 continue-on-error，末尾仅记录事件 SHA，不生成成功或发布证明。

不在 workflow 内使用本人的设备 token，不上传私有需求全文，不自动审批或部署。平台审核门禁与预览配置保留为需要真实外部证据的独立事项。
