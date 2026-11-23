# 多语言插件（i18n-multilang）

AgileCampus 标准插件首个官方示例：启用后页面左下角出现 🌐 切换器，
界面文案可切换为 **英语 / 日语 / 法语 / 俄语**，随时切回中文。

- 权限：`ui:translate`（文本替换）、`ui:mount`（切换器）、`storage:local`（记忆语言选择）
- 原理：DOM 文本节点与 `placeholder/title/aria-label` 属性按词典精确替换，
  MutationObserver 跟踪 SPA 局部刷新；停用时完整还原全部原文。
- 词典型测试：宿主仓库 `tests/i18n-dictionary.test.ts`（四语键集一致 / 无空值）。

文件：`plugin.ts`（插件主体）· `dictionary.ts`（四语词典）。
完整标准格式见上级目录 [PLUGIN-SPEC.md](../../docs/PLUGIN-SPEC.md)。
