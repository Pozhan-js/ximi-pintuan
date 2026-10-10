# 任务 01：工程底座与交付检查

平台任务：CHG-214012ff-fc79-45b4-8de3-84bd33018937，revision 1。关联产品版本 v1.0.0，两份需求链接沿用 .deliveryguard/versions/v1.0.0.json；未读取原文 revision，产品确认仍待办。

目标是令本人项目配置一致，并以名称为 harness-check 的 GitHub job 对真实提交执行冻结安装、项目核对、lint、类型检查、生产构建、HTTP 冒烟与 DeliveryGuard 检查。复用现有三个工作区包与测试，不新增业务行为。

范围为项目关联、version-manifest、检查脚本、GitHub Actions、README 和任务验收矩阵。业务 OpenSpec pintuanwa-v1、业务验收及生产发布保持原有状态。本人已授权本工程任务先实现；原文、fly 哥确认、私有仓库及预览仍缺证据。

受影响仓库为本地 app（平台 web）。平台任务范围需要补充 .book；当前分支旧提交中的下载文件不自动获得范围或审核批准。

验收按 docs/task-01-status.md 五项逐一核对；本地检查通过不等同远程 CI、产品验收或发布。
