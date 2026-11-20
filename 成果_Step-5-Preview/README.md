# 课程项目成果总索引 · 由 Step-5-Preview 生成

本目录汇总交互设计课程项目 **AgileCampus 敏捷校园** 的 AI 辅助产出。
目录名标注了产出模型：`Step-5-Preview`。

> 规矩：所有新想法、修复、产出都放在各自**新建的分支**上，不改动任何已有分支或已有内容。
> 本目录位于分支 `terry/deliverables`，是一个纯新增的汇总分支。

---

## 一、顶层成果（双击即可打开）

| 文件 | 内容 | 对应分支 |
|---|---|---|
| `1_全功能整合原型.html` | terry 线 + student 线全功能整合效果展示原型 | `terry/merged-prototype` |
| `2_分支审查报告.html` | 14h 前上传分支的问题清单、修改建议、验收结论 | `terry/review-report` / `terry/review-fixes` |
| `3_Persona用户建模.pptx` | 12 页用户 Persona 建模（按《5.Persona用户建模.pptx》课件） | `terry/persona-modeling` |
| `4_新手导引_可交互.html` | 平台内 8 步新手导引的可交互预览 | `terry/onboarding-guide` |
| `分支拓扑图.svg` | 所有分支的演进关系图 | `terry/review-report` |
| `整合原型-说明.md` | 整合原型的范围与合并方案说明 | `terry/merged-prototype` |
| `新手导引-效果预览.png` | /guide 页面效果截图 | `terry/onboarding-guide` |

## 二、Persona 源文件（`persona-source/`）

| 文件 | 内容 |
|---|---|
| `DESIGN.md` | 12 页 PPT 的设计说明（配色、版式、每页要点） |
| `slides/01.slide` ~ `12.slide` | 逐页源文件（按 01-12 顺序） |
| `preview/f*.png` | 部分页面的预览图 |

> 已排除 `.cache/`、`.slidep/` 等生成过程中的临时产物。

## 三、功能代码成果（在各自分支，不在此目录）

这些是真正跑在项目里的功能，代码在对应分支，说明文档在 `docs/`：

| 分支 | 功能 | 说明文档 |
|---|---|---|
| `terry/ai-dashboard-acceptance` | AI 日报 / 日历 / tasks 验收、东八区口径统一 | `docs/` |
| `terry/v63-bugfix` | v6.3 功能回归修复（被删的日报/日历/进度）、时区与 lint 修复 | `docs/v63-bugfix-2026-11-19.md` |
| `terry/guide-entry` | 工作台顶栏 + 左侧图标栏两个新手导引入口 | `docs/onboarding-guide/` |
| `terry/password-recovery` | 忘记密码 / 找回密码（邮箱 6 位验证码） | `docs/password-recovery-说明.md` |
| `terry/personal-suite` | 效率中心 `/suite`：日历 + 待办 + 记事三合一 + 全局入口 | `docs/personal-suite-说明.md` |
| `terry/smooth-motion` | 统一动效层 `app/motion.css` | `docs/smooth-motion-说明.md` |

---

## 四、怎么打开 / 怎么运行

### 1. 直接看成果（不需要跑服务）
- 双击顶层的 `1_` / `2_` / `4_` 三个 `.html` 即可在浏览器打开
- `3_Persona用户建模.pptx` 用 PowerPoint / WPS 打开

### 2. 跑真实平台（需要 Docker + Node）

```bash
cd Agile-Development-Platform-ai-dashboard
docker ps                      # 确认 agilecampus-db 容器在运行
npm install
npm run dev                    # 看终端输出的端口，通常是 3000；若被占用会自动用 3001
```

`.env.local` 需包含：
```
DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus
```
该文件已被 git 忽略，不会入库。

### 3. 主要页面

| 地址 | 内容 |
|---|---|
| `http://localhost:3001/` | 首页 |
| `http://localhost:3001/login` | 登录 / 注册 / 忘记密码 |
| `http://localhost:3001/workspace` | 工作台（AI 日报、日历、任务进度） |
| `http://localhost:3001/guide` | 新手导引（右上角或左侧栏 `?` 进入） |
| `http://localhost:3001/suite` | 效率中心（日历 / 待办 / 记事） |

> 演示账号：`beta@stu.edu.cn` / `123456`（登录后右下角出现「效率中心」悬浮按钮）。
> `/suite`、`/workspace` 有登录守卫，未登录会跳到登录页，属正常。

### 4. 验证命令

```bash
npm run lint
npm test                       # node --import tsx --test tests/*.test.*
npm run build
```

已知：测试 75/77 通过，2 个失败是基线既有的事务测试（成员通知 / 任务写入回滚），与 AI 产出无关。

---

## 五、当前状态

- 远程共 21 条分支，`main` 仍停在早期版本，未做任何合并（遵守"不改动已有分支"）
- 本汇总分支 `terry/deliverables` 只新增 `成果_Step-5-Preview/` 一个目录，未修改任何已有文件
- 服务运行在 `http://localhost:3001/`，所有页面 HTTP 200
