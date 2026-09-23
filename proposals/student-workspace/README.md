# 学生项目工作台候选功能包

这是一个供团队评估和选择的候选实现，不会覆盖仓库根目录的现有代码。

## 目录

- `FEATURE-MAP.md`：功能包清单、适用场景和优先级。
- `ADOPTION-GUIDE.md`：队友如何查看、挑选和采用功能。
- `integration-notes/database.md`：数据库表和同步注意事项。
- `integration-notes/environment.md`：环境变量和本地运行要求。
- `integration-notes/cherry-pick-guide.md`：按提交选择功能的操作方法。
- `implementation/`：一份平行实现，仅供运行、评估和对照，不会替换仓库根目录代码。

## 推荐阅读顺序

1. 先看 `FEATURE-MAP.md`，确认需要哪些功能。
2. 再看 `ADOPTION-GUIDE.md`，选择整体参考、单项采用或暂不采用。
3. 需要运行平行实现时，进入 `implementation/`，按其中的 README 配置环境。
4. 需要合并代码时，只选择 Pull Request 中标记的对应提交。

## 重要边界

- 本提案不修改原有 `main`。
- 本提案不自动合并 Pull Request。
- `.env`、`.env.test`、数据库密码、API Key 和 `node_modules` 不在提案中。
- AI、Agent API、飞书功能均为可选扩展，不是基础学生项目管理功能的启动前置条件。
