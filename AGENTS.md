# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

# Constraints

1. Add detailed Chinese comments to the code you write.
2. Always reply in Simplified Chinese.

# Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# Commands

```sh
npm install              # 安装依赖（Node ^20.19 或 >=22.12）
npm run dev              # Vite 开发服务器，默认 5173；在 Windows 上常绑定 IPv6（用 http://localhost:5173/）
npm run build            # 生产构建
npm run preview          # 本地预览构建产物
npm run format           # Prettier 格式化 src/（experimental-cli）
```

无测试框架、无 lint 命令；仓库内只有 `prettier` 一个代码质量工具。

# Architecture

## Tech Stack

Vue 3（`<script setup>`）+ Vite 8 + Pinia（setup style）+ Vue Router 4（history 模式）+ axios + PrimeVue 4（Aura preset）。路径别名 `@` → `src/`（`vite.config.js` 与 `jsconfig.json` 中各配置一处，二者要同步）。

## 鉴权模型（项目特有，最容易踩坑的部分）

**后端用 HTTP Session + Cookie，前端不持有 token。** 关闭浏览器即 session 失效，这是设计意图。

- `src/api/http.js`：`withCredentials: true` 让浏览器自动带 cookie；**不要**添加 `Authorization` / `Bearer` 头。
- `src/stores/auth.js`：只维护一个 `loggedFlag`（`sessionStorage` 持久化，key=`novels_ai_logged_in`），用于路由守卫与 UI；真正的鉴权完全由后端 cookie 完成。**不要**改用 `localStorage`——会和后端 session 寿命错位。
- `src/router/index.js`：`beforeEach` 中调用 `useAuthStore()` **必须放在守卫函数体内**（不能写在模块顶层），否则 Pinia 尚未注册会报 `getActivePinia called with no active pinia`。

## API 层（src/api/）

- `http.js` 响应拦截器只剥 axios 外壳，直接返回 `response.data`（即后端 `common.Response` 结构 `{ code, data, msg }`）。**业务码不在拦截器内当错误处理**，调用方写 `if (res.code === 0)` 自行分流。
- HTTP/网络错误归一化为 `{ status, message, raw }` 抛出。
- 业务码常量集中在对应文件内（如 `LoginCode` 在 `login.js`），避免到处 `if (code === 1000)`。
- `upload.js` 上传单文件需要在请求级覆盖 `Content-Type: multipart/form-data`（默认实例是 JSON），并把 `timeout` 调宽到 30s。
- `novel.js` 中 `updateNovel` 的 OAS 文档存在矛盾（path 写 `/novels/update` 但 parameters 标 `in:path`）；当前实现按字面路径，把 id 放在 body 内。若后端实际是 `/novels/update/{id}`，只需改这一处。

## 路由

- `/login`（`meta.public: true`，唯一无需登录的页面）
- `/` → 重定向到 `/shelf`
- `/shelf`（书架主页，业务主入口）
- `/novel/:id(\d+)`（详情/编辑/删除，`props: route => ({ id: Number(route.params.id) })` 注入数字 id）
- 兜底 `/:pathMatch(.*)*` → `/shelf`

守卫职责：同步 `document.title`（来自 `meta.title`）；未登录访问受保护页面 → 跳 `/login` 并把目标放到 `query.redirect`；已登录访问 `/login` → 跳书架。

## PrimeVue 集成

- `main.js` 注册 `PrimeVue` + `Aura` 主题 + `ToastService` + `ConfirmationService`。
- `App.vue` 全局挂载 `<Toast position="bottom-right" />` 与 `<ConfirmDialog />`（这两个只挂一次即可，所有组件通过 `useToast()` / `useConfirm()` 触发）。
- **没有安装 primeicons**，不要使用 `icon="pi pi-*"`；如需图标先 `npm i primeicons` 并在入口引 CSS。
- 设计原则：PrimeVue 按需用（Dialog / Toast / ConfirmDialog / Button / InputText / Textarea），视觉重的组件（书架、书本卡片、封面上传、登录玻璃卡）全部自写 CSS，不依赖主题。

## 关键组件

- `components/BookCard.vue`：3D 书本视觉（spine + cover + gloss），无封面时按 title hash 选 8 套渐变之一（哈希稳定 → 同书每次渲染同色）。
- `components/CoverUploader.vue`：`v-model:coverUrl` 字符串。点击/拖拽上传，max 5MB，仅 `image/*`。
  - **「弹两次 picker」BUG 的根因**：调用方若用 `<label>` 包裹本组件，浏览器会把内部隐藏的 file input 当作 label 的 control，点击落区域时除组件自己的 `inputRef.click()` 外还会再触发一次浏览器的 label 默认行为。**修复方式**：调用方用 `<div class="row">` 而非 `<label class="row">` 包裹 `<CoverUploader>`（已在 `ShelfView.vue` 与 `NovelDetailView.vue` 中落地，**不要**改回 label）。组件根 div 不能加 `@click.prevent`——会把 `inputRef.click()` 冒泡上来的事件 default action 也一并取消，导致 picker 完全打不开。

## 开发期网络

- `vite.config.js` 配置 `'/api'` → `http://localhost:8080` 代理 + `changeOrigin: true`。
- 生产环境通过 `VITE_API_BASE_URL` 注入完整后端地址（覆盖默认的 `/api/v1`）。

## 自动记忆

项目级 auto-memory 已记录鉴权设计在 `C:\Users\Administrator\.Codex\projects\D--projects-font-Novels-AI-Font\memory\`。会话结束前如学到新的项目级事实（接口契约、设计约定、踩坑根因），按 auto memory 规则更新。
