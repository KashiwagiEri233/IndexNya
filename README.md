# Index 学习岛

> 面向大学生的本地单用户学习工具（数据全部保存在本机，不区分多用户）
> **技术栈：React + TypeScript 全栈（Node.js）**

## 功能

1. **学习对话与记录** — 通过对话梳理专业方向、学习目标和当前难点，自动记录完整学习过程
2. **学习资料整理** — 生成讲解文档、思维导图、拓展阅读、代码案例；需要视频时提供 Bilibili 相关视频链接
3. **互动刷题** — 通过 `ask_question` 工具一题一题地给学生出练习题：出题 → 作答 → 即时批改讲解 → 下一题；支持选择题点选与自由作答，可随时结束并汇总正确率
4. **错题本** — 互动刷题中出过的题目自动入库（题目/选项/答案/解析/对错），可在「错题本」页筛选查看、删除，并可一键「重练错题」回到对话页逐题重做
5. **技能系统** — 技能以 Markdown 指令文件存储（`src/runtime/skills/*/SKILL.md`），在「设置」页可随时安装、卸载、开启/关闭；已开启的技能会被 agent 当作工具（`use_skill`）在对话中主动调用
6. **层级对话（哪里不懂点哪里）** — 点击回答/文献中的术语，卡片在主线旁丝滑展开：子卡片、关联卡片、分支卡片；卡片树持久化，支持选中文本追问/引用以及导入 PDF / TXT / Markdown 文献
7. **思维宇宙** — 用自己的话总结概念，AI 评审认可后存入个人理解库；所有理解以 3D 知识网络呈现，讲解新概念时自动调用已掌握的理解作为知识锚点
8. **多种答疑方式** — 支持文字、图片（上传题目/图表，由多模态模型直接识别解答），并可推荐 Bilibili 相关视频
9. **消息编辑 / 删除 / 引用** — 修改自己的提问、整轮删除（级联清理其探索卡片）、选中文本作为引用随问题发送
10. **外观主题** — 支持浅色 / 深色 / 跟随系统三档模式；可自定义主色，设置自动保存
11. **数据备份 / 恢复与导出** — 支持 session log 全量备份/恢复、对话导出为 Markdown 笔记 + Mermaid 思维导图、个人配置备份

## 技术栈

- **全栈运行时**：Node.js 22.5+ · TypeScript · 原生 `node:sqlite` · Node 原生 HTTP / SSE
- **页面层**：Vite · React 18 · TypeScript · Tailwind · react-force-graph-3d
- **模型接口**：任意 OpenAI 兼容模型（模型配置保存在浏览器本地存储，请求时通过同源 API 发送）
- **文献与技能**：Node `Request.formData()` 处理上传；内置轻量 PDF 文本兜底解析；ZIP 技能包由 TypeScript 安全解压

> 页面与 API 由同一个 Node.js 进程提供：开发时由 `src/runtime/dev.ts` 挂载 Vite middleware，生产时由 `src/runtime/index.ts` 直接托管 `dist`。完全移除 Python/FastAPI 后端依赖。

## 快速开始

### 环境要求

- Node.js **22.5+**（推荐 24+；运行时使用 `node:sqlite`）
- npm 10+
- 如需调用 AI：一个 OpenAI 兼容模型的 Base URL、API Key 与模型名

### 开发模式（单进程）

```bash
# 在项目根目录执行
npm install
npm run dev
```

或使用一键脚本：

```bash
./start.sh                 # macOS / Linux / Git Bash
.\start.ps1                # Windows PowerShell
.\start.ps1 -Port 5174    # 自定义端口
```

打开 <http://localhost:5173>。页面与 API 共用同源地址，API 入口为 `/api`，不再有单独的 `localhost:8000` 服务。

### 构建与生产运行

```bash
npm run build
PORT=4173 npm run start       # macOS / Linux
# PowerShell：$env:PORT=4173; npm run start
```

构建会完成两步：

1. 根目录 `src` 的 TypeScript 类型检查与 Vite 静态资源构建；
2. 使用 esbuild 将 `src/runtime/index.ts` 打包到 `dist-server/index.js`。

生产模式只启动一个 Node 进程，同时提供静态页面、JSON API、multipart 上传和 SSE 流。

### 数据迁移

应用数据自动保存在本地 SQLite 文件中：
- 默认路径：`data/learning_agent.db`
- 自定义路径：可通过环境变量 `INDEXNYA_DB_PATH` 配置

## 目录结构

```text
IndexNya/
├── src/                       # 统一应用源码（页面、领域逻辑、运行时）
│   ├── components/            # 布局、设置、探索卡片、Markdown
│   ├── pages/                 # Chat / Practice / Literature / Universe
│   ├── stores/                # Zustand 本地状态
│   ├── lib/api.ts             # 同源 fetch + SSE 客户端
│   └── runtime/               # TypeScript 全栈运行时，不是独立的前后端项目
│       ├── index.ts           # 生产入口
│       ├── dev.ts             # Vite middleware + API 单进程入口
│       ├── runtime.ts         # Node HTTP、静态托管、SSE、错误处理
│       ├── api.ts             # REST 路由与 multipart 入口
│       ├── db.ts              # node:sqlite schema、迁移、事务
│       ├── repository.ts      # SQLite 查询与领域数据映射
│       ├── llm.ts             # OpenAI 兼容接口、流式输出、工具调用
│       ├── chat.ts            # 路由、对话流、技能与互动刷题
│       ├── hierarchy.ts       # 探索卡片 SSE 与卡片树
│       ├── agents.ts          # 资源、辅导、术语抽取、思维导图
│       ├── universe.ts        # 本地向量、锚点、知识图谱
│       ├── literature.ts      # PDF/TXT/Markdown 解析
│       ├── skills.ts          # Markdown 技能与 ZIP 安装
│       ├── data.ts             # session log 与笔记导出
│       └── tests/              # 服务端单元测试
├── public/                    # 页面静态资源
├── scripts/build-server.mjs   # esbuild 服务端打包脚本
├── tsconfig.json              # 页面 TypeScript 配置
├── tsconfig.server.json       # 运行时 TypeScript 配置
├── package.json               # 统一依赖与脚本
├── data/                      # 运行时数据（自动生成，已加入 gitignore）
```

## 请求处理时序

1. 页面通过同源 `/api` 发起请求；普通数据使用 JSON，长任务使用 SSE。
2. `src/runtime/api.ts` 解析请求并交给领域模块，`src/runtime/db.ts` 使用同步 SQLite 查询，避免额外 ORM 运行时。
3. 对话先经过本地关键词路由，必要时再调用轻量意图判定；资源、辅导、技能和刷题分别执行专用 prompt。
4. 模型文本边生成边写入 SSE；消息落库后发送 `done`，术语和验收信息随后补发。
5. 生产构建后的静态页面与 API 由同一个 `src/runtime/index.ts` 进程托管。

## API 能力

保留原有页面契约，迁移后仍支持：

- `/api/chat`、`/api/models/test`
- `/api/conversations/*`、`/api/messages/*`
- `/api/resources/*`、`/api/tutor/ask`
- `/api/hierarchy/*`、`/api/practice/*`
- `/api/literature/*`、`/api/image/understand`
- `/api/universe/*`、`/api/skills/*`
- `/api/data/export`、`/api/data/import`、`/api/data/export-notes`

## 模型配置

模型在网页左下角「设置」中配置，保存在浏览器 localStorage，不需要 `.env`。支持多个 OpenAI 兼容提供商和模型；图片理解会复用当前选中的模型，因此需要选择支持 vision 输入的模型。

## 扩展技能

### 设置页安装（推荐）

打开「设置 → 技能管理」，上传包含 `SKILL.md` 的 `.zip` 技能包。压缩包可以直接包含 `SKILL.md`，也可以包含一个或多个技能文件夹。安装、开关和卸载立即生效，无需重启。

### 直接添加内置技能

内置技能位于 `src/runtime/skills/<name>/SKILL.md`，格式示例：

```markdown
---
name: my_skill
title: 我的技能
description: 一句话说明何时使用
---
这里是完整执行指令，模型加载后会严格遵守。
```

运行时技能状态保存在 `data/skills.json`，用户安装的技能保存在 `data/skills/`，不会修改源码目录。

## 测试与检查

```bash
npm run typecheck
npm run test
npm run build
```

## 开源协议

本项目基于 [GNU General Public License v3.0 (GPLv3)](./LICENSE) 协议开源。
