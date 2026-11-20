# 动效增强层 · 第二轮（terry/motion-polish）

从 `terry/deliverables` 新建分支，纯追加，**不修改 `motion.css` 任何一行**，也不改动任何其他分支。

## 为什么还要做第二轮

`terry/smooth-motion` 解决了「节奏不统一 + 进场硬切」，但只管**进场**，没管**手感**：

| 生硬点 | 第一轮 | 第二轮 |
|---|---|---|
| 卡片 hover | 只有 `.15s` 边框/阴影变色，无位移 | 轻微上浮 + 阴影呼吸 |
| 视图切换 | 新内容淡入，旧内容瞬间消失 | 用 `@starting-style` 补滑入；SPA 内的离场仍需组件层配合（见局限） |
| 列表增删 | 周围项瞬间跳位 | 新增项复合进场、勾选完成平滑变淡 |
| 滚动 | 滚动条出现时内容横向抖动 | `scrollbar-gutter: stable` + 细滚动条 |
| 侧栏选中 | 直接换底色 | 强调线滑入 |
| 页面跳转 | 整页硬切 | View Transitions 渐进增强 |

另外，第一轮动画只在**页面加载时播一次**，用户开着页面不刷新就感受不到——第二轮的 hover/选中/勾选是**每次交互都会触发**，更容易被感知。

## 关键技术决策

### 1. 用 `translate` / `scale`，不用 `transform`
`motion.css` 给卡片/列表加了 `animation: motion-enter ... both`，动画结束后 `transform` 被锁成 `none`。如果增强层还用 `transform` 做 hover，会被动画覆盖而**完全失效**。

CSS 的 `translate`、`scale` 是独立于 `transform` 的属性，互不干扰，因此这里全部改用它们。

### 2. 卡片 `transition` 规则必须带 `html[data-theme]` 前缀
`motion.css` 用 `html[data-theme] .ws-today-card` 这种高特异性选择器声明了主题切换的颜色过渡。如果增强层用低特异性 `.ws-today-card` 再声明 `transition`，**整条 transition 会被覆盖**（CSS 里 `transition` 是单一简写属性，不会合并），导致主题过渡丢失、hover 也变瞬时。

所以本层卡片规则用同样的前缀，并把 `background-color / color / border-color / box-shadow` 全部合入，再追加 `translate`。配合 `layout.tsx` 中 import 顺序（`motion.css` 在前、`motion-polish.css` 在后），同特异性下由本层生效，两者效果都保留。

### 3. 不叠加 `animation-name`
已有 stagger 错峰动画的元素不再叠第二层 `animation`，避免两套动画争抢 `transform`/`opacity` 导致闪烁或元素不可见。改用 `@starting-style` + `translate` 过渡做「复合进场」，只在元素首次渲染时提供起点，不支持该特性的浏览器直接正常显示。

### 4. 性能
只动 `translate / scale / opacity / 颜色`，不触碰 `width / height / top / left`，不触发重排。`prefers-reduced-motion: reduce` 一次兜底关掉本层全部动效。

## 改动文件

| 文件 | 说明 |
|---|---|
| `app/motion-polish.css` | 新增，第二轮增强层（约 190 行） |
| `app/layout.tsx` | 仅追加一行 `import "./motion-polish.css";` |
| `docs/motion-polish-说明.md` | 本文档 |

## 局限（诚实说明）

- **SPA 视图切换的「离场」动画**：工作台 `railView` 是条件渲染，旧节点被 React 直接卸载，纯 CSS 无法给不存在的节点做淡出。要真正解决需改组件逻辑（保留旧节点做双缓冲），本轮按「不改已有内容」的约束没有动。可用 View Transitions API 在组件层封装，作为后续分支。
- **`@view-transition { navigation: auto }`** 只对整页导航/刷新生效，Next.js 客户端路由（`router.push`）不触发；属于渐进增强，不支持的浏览器完全忽略。
- **`@starting-style` / `scrollbar-gutter` / `translate`** 均为渐进增强，老浏览器降级为「直接显示」，不会报错。
- 本轮只做了**代码与构建层验证**，动效手感建议在浏览器里实际点几下（hover 卡片、勾选待办、切视图、切主题）确认。

## 验证

```bash
npm run lint     # 通过
npm test         # 75/77（2 个为基线既有事务测试失败，与本轮无关）
npm run build    # 通过
```

## 怎么打开

```
http://localhost:3001/workspace   点左侧图标栏切视图、hover 卡片
http://localhost:3001/suite       勾选待办、hover 记事卡片、切 Tab
http://localhost:3001/           首页切主题看颜色过渡
```
