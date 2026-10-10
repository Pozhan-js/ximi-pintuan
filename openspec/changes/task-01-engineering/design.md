# 实现方案

将 .book/project.json、deliveryguard.config.json 与 guild:connect 关联至平台本人项目，version-manifest.json 仅登记真实原始文档链接，不填写未获取的 revision。

使用现有 pnpm workspace 的构建顺序与 HTTP 冒烟；增加登记一致性断言，防止配置回退到模板项目或主 PRD 与版本登记漂移。

harness-check 对 main、codex 分支推送和面向 main 的 PR 运行；只授予 contents:read，官方 Actions 固定实际版本 SHA，依赖冻结安装。每一步使用正常失败退出，不设置 continue-on-error，末尾仅记录事件 SHA，不生成成功或发布证明。

不在 workflow 内使用本人的设备 token，不上传私有需求全文，不自动审批或部署。平台审核门禁与预览配置保留为需要真实外部证据的独立事项。
