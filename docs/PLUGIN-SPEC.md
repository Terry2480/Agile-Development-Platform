# AgileCampus 插件标准格式（Plugin Specification）

> 版本：PLUGIN-SPEC/1.0 · 适用于 AgileCampus v6.5+
> 本文档同时以独立副本维护在 `plugin-spec` 分支（不含项目代码），供插件开发者单独取用。

## 一、插件是什么

插件是**给平台增添功能的独立模块**：不修改任何平台源码，通过宿主提供的生命周期与上下文运行，可随时启用/停用，停用后必须完全还原现场。首个示例为多语言插件（`plugins/i18n-multilang/`）。

## 二、目录与文件约定

```
plugins/
  <plugin-id>/            # kebab-case，全局唯一
    plugin.ts             # 必需：导出 default（或命名导出）一个 AgileCampusPlugin
    README.md             # 必需：功能说明、权限用途、测试记录
    *.ts / *.css          # 可选：词典、纯函数等伴随模块（样式由插件自行注入或声明）
```

上架：在 `lib/plugins/registry.ts` 的 `builtinPlugins` 数组中注册即出现在插件商城（`/plugins`）。

## 三、清单字段（AgileCampusPlugin 接口）

```ts
import type { AgileCampusPlugin } from "@/lib/plugins/types";

const myPlugin: AgileCampusPlugin = {
  id: "hello-world",              // 必需。kebab-case 唯一标识
  name: "问候插件",                 // 必需。商城显示名
  version: "1.0.0",               // 必需。语义化版本（major.minor.patch）
  author: "张三",                  // 必需。
  description: "在页面角落显示问候。", // 必需。一句话功能描述
  category: "productivity",       // 必需。language|productivity|theme|integration|other
  icon: "👋",                     // 必需。emoji 或单字符图标
  permissions: ["ui:mount", "storage:local"], // 必需。声明用到的全部权限点
  activate(ctx) { /* 启用：挂 UI、注册监听 */ },
  deactivate() { /* 停用：必须卸载 UI、断开监听、还原文本 */ },
};
export default myPlugin;
```

## 四、权限点

| 权限 | 含义 | 停用时必须还原 |
| --- | --- | --- |
| `ui:translate` | 遍历并替换页面文本节点/属性 | 恢复全部原文 |
| `ui:mount` | 向 `document.body` 挂载自有元素 | `remove()` 全部挂载元素 |
| `storage:local` | 读写 `plugin.<id>.*` 命名空间 localStorage | 数据保留（用户数据不删） |
| `api:read` | 以当前登录态调用平台只读接口 | — |
| `network:external` | 访问平台外网络 | — |

权限在商城卡片上明示；未声明的权限不应使用。

## 五、生命周期与上下文

- **activate(ctx)**：用户在商城点「启用」或刷新页面时调用（每页面一次）。`ctx` 提供：
  - `ctx.storage.get/set/remove(key)` —— 插件专属命名空间；
  - `ctx.api<T>(path)` —— 平台只读接口（同 `lib/api-client` 的 `api()`）；
  - `ctx.hostVersion` —— 宿主版本，供能力探测。
- **deactivate()**：点「停用」或离开站点时调用。**验收标准：停用后页面与未安装插件时逐像素一致**（不留 DOM、不留监听器、已改文本全部还原）。
- 插件应为重复 activate 做幂等防护（先清理再挂载）。

## 六、开发检查清单

- [ ] 目录名 = `id`；含 `plugin.ts` 与 `README.md`
- [ ] 清单字段完整；`version` 随每次发布递增
- [ ] 权限最小化：只声明实际用到的点
- [ ] `deactivate()` 后页面无残留（DOM / 事件 / MutationObserver / 定时器）
- [ ] 昼夜两主题下自有 UI 均可读（使用 `--ws-color-*` 令牌）
- [ ] 纯逻辑（词典/算法）拆为独立模块并附 `tests/*.test.ts` 单测
- [ ] 不修改 `app/`、`components/` 下任何平台文件

## 七、最小完整示例

```ts
// plugins/hello-world/plugin.ts
import type { AgileCampusPlugin } from "@/lib/plugins/types";

let el: HTMLElement | null = null;

export default {
  id: "hello-world",
  name: "问候插件",
  version: "1.0.0",
  author: "AgileCampus 团队",
  description: "在左下角显示一条问候，停用即消失。",
  category: "other",
  icon: "👋",
  permissions: ["ui:mount"],
  activate() {
    el?.remove();
    el = document.createElement("div");
    el.className = "hello-tip";
    el.textContent = "插件运行中 👋";
    document.body.appendChild(el);
  },
  deactivate() {
    el?.remove();
    el = null;
  },
} satisfies AgileCampusPlugin;
```

配套样式由插件用内联或自建 `<style>` 注入，停用时一并移除。

## 八、版本与兼容

- 宿主按 `PLUGIN-SPEC` 主版本号判断兼容；`hostVersion` 可用于条件降级。
- 破坏性变更（字段更名、权限收紧）会提升规范主版本并在本文档顶部标注。
