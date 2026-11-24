# V7.4 本地运行报错修复记录：ViewTransition InvalidStateError

日期：2026-11-22 · 基线版本：v7.4（提交 `17a6dc7`）· 状态：已修复并本地验证，**尚未提交推送**

---

## 一、问题现象（改动前）

在本地开发模式（`npm run dev`，Turbopack）下打开 `http://localhost:3000/workspace`，页面右上角弹出 Next.js 开发浮层，显示运行时错误：

```text
Runtime InvalidStateError
Transition was aborted because of invalid state. ViewTransition opt-in disabled
```

浮层顶部带有 "1/1" 计数，右上角显示 "Next.js 16.3.6 (stale)" 标签（说明页面发生过整页自动刷新）。

**特征**：报错出现于整页跳转 / 热更新自动刷新之后；页面功能、数据、渲染本身全部正常，仅弹出一个错误浮层。

## 二、诊断过程

按以下顺序排查，每步都有证据：

| 步骤 | 操作 | 结论 |
| --- | --- | --- |
| 1 | 读截图识别报错原文 | 错误类型为 `InvalidStateError`，消息含 "ViewTransition opt-in disabled"，属于浏览器 View Transitions API。 |
| 2 | 全源码检索 `startViewTransition` / `viewTransition`（components/app/lib，TS 与 CSS） | 项目代码中**零调用**，next.config 也未开启 `experimental.viewTransition`，排除业务代码直接使用。 |
| 3 | 查最新 dev 日志（`dev-v65.log` 末尾 100 行） | 所有 API 请求全部 200，无任何服务端错误/堆栈，只有正常的工作台轮询（chat/activities/notifications/overview/dm/tasks/files）。排除后端与数据库原因。 |
| 4 | 检索 react-dom / next / react 包内该报错文案 | 包内无此字符串，确认异常不是框架 JS 抛出，而是 Chromium 内部产生。 |
| 5 | Web 检索报错原文 | 命中多个已知问题：Chromium 把「被中止的跨文档视图过渡」当作未捕获 `InvalidStateError` 抛给页面；React 官方 issue #37751、TanStack Router #7733 均报告同一现象。 |
| 6 | 全仓 CSS 检索 `@view-transition` | 命中 `app/motion-polish.css:156` —— terry 动效层第 7 节开启了跨文档视图过渡，即唯一触发源。 |

## 三、根因分析

`app/motion-polish.css` 第 7 节（页面级导航动效）开启了 Chrome 的跨文档视图过渡：

```css
@view-transition { navigation: auto; }
```

该规则让 Chrome 在**整页跳转 / 刷新**时对新旧页面做交叉淡入淡出（SPA 客户端路由不触发）。完整因果链：

1. 开发模式下 Turbopack 检测到代码更新 → 页面整页自动刷新（浮层 "stale" 标签即此证据）；
2. 刷新瞬间旧页面的视图过渡尚未就绪、新页面已经显示（invalid state）；
3. 按 W3C 规范此场景应**静默中止**过渡，但 Chromium 存在缺陷，将其作为未捕获的 `InvalidStateError` 抛出；
4. Next.js 开发浮层捕获该未捕获异常并显示为运行时报错。

**影响评估**：纯属开发期噪音。仅表示"这一次刷新的淡入淡出动画被跳过"，功能、数据、持久化全部正常；生产环境正常使用极少触发。属于浏览器缺陷 + 渐进增强 CSS 的组合问题，非任何人的代码 Bug。

## 四、改动明细

### 改动处 1：`app/motion-polish.css` 第 7 节（原 156-161 行）

**改动前**：

```css
/* ---- 7. 页面级导航：View Transitions 渐进增强 ----
   对整页跳转/刷新自动交叉淡入淡出；SPA 客户端路由不触发（Next.js 限制），
   不支持该 API 的浏览器完全忽略，无任何副作用。 */
@view-transition { navigation: auto; }
::view-transition-old(root) { animation: motion-vt-out var(--motion-fast) var(--motion-ease) both; }
::view-transition-new(root) { animation: motion-vt-in var(--motion-base) var(--motion-ease-out) both; }
@keyframes motion-vt-out { to { opacity: 0; } }
@keyframes motion-vt-in { from { opacity: 0; } }
```

**改动后**（删除规则，保留说明注释防止回归）：

```css
/* ---- 7. 页面级导航：View Transitions —— 已禁用 ----
   @view-transition { navigation: auto; } 会让 Chrome 在整页跳转/刷新时做跨文档
   交叉淡入淡出，但开发模式下 Turbopack 热更新触发的自动刷新会让过渡被打断，
   Chrome 把中止当成未捕获的 InvalidStateError（"Transition was aborted because
   of invalid state. ViewTransition opt-in disabled"）抛给页面，被 Next 开发浮层
   显示成运行时报错（Chromium 已知缺陷，见 react#37751）。SPA 路由本就不触发
   该动画，收益仅剩整页刷新的一瞬淡入，故移除以换取干净的控制台。 */
```

### 改动处 2：`app/motion-polish.css` 无障碍兜底段（原 194 行）

**改动前**：

```css
.ws-rail-btn::before { display: none !important; }
::view-transition-old(root), ::view-transition-new(root) { animation: none !important; }
```

**改动后**（配套动画已删，此行成为死代码，一并移除）：

```css
.ws-rail-btn::before { display: none !important; }
```

### 代价

唯一损失是「整页刷新瞬间的交叉淡入淡出」。该效果只在整页刷新 / 硬跳转时出现（站内路由切换从不触发），肉眼几乎不可感知。同文件其余动效——卡片 hover 上浮、图标微移、列表复合进场、勾选过渡、滚动条优化——均未改动。

## 五、修复验证（改动后）

在浏览器中对 `http://localhost:3000/workspace` 连续 **3 次整页刷新**（正是此前触发报错的场景）：

| 检查项 | 结果 |
| --- | --- |
| Next 错误浮层是否出现 `InvalidStateError` / "Transition was aborted" | **3 次全部干净，无任何报错** |
| 页面渲染完整性（DOM 检查） | 左栏 15 个按钮、10 个文字标签（今日/项目管理/团队管理/工作台/通知/待办/私聊/云文档/导引/插件）全部在位，栏宽 64px 符合设计 |
| 视觉确认（截图） | 项目面板、看板、右侧栏、页脚样式正常，选中态高亮正常，无样式错乱 |
| 服务端日志 | 无新增错误 |

## 六、参考

- [React issue #37751 — ViewTransition reports Chromium's error as uncaught](https://github.com/react/react/issues/37751)
- [TanStack Router discussion #7733 — Unhandled AbortError/InvalidStateError](https://github.com/TanStack/router/discussions/7733)
- [Anvil Works forum — InvalidStateError: Transition was aborted](https://anvil.works/forum/t/router-invalidstateerror-transition-was-aborted-because-of-invalid-state/25769)
- MDN：[View Transitions API](https://developer.mozilla.org/docs/Web/API/View_Transitions_API)、[@view-transition 规则](https://developer.mozilla.org/docs/Web/CSS/@view-transition)

---

**备注**：本修复目前仅存在于本地工作区（`app/motion-polish.css` 已修改，未提交），待随下一个版本一并推送。若 Chromium 未来修复该缺陷，可依据本文档第四节恢复原代码。
