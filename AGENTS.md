# Index 学习岛 (IndexNya) — Agent 协作指南

本文档为 AI Coding Agent 与开发者提供本项目（IndexNya）的架构概览、代码约定、核心系统设计及常用指令。

---

## 1. 项目简介

**Index 学习岛** 是一款面向大学生的本地单用户学习工具（数据全部保存在本机 SQLite，不区分多用户）。

- **架构形态**：单进程 TypeScript 全栈（React 18 前端 + 原生 Node.js 服务端运行时）
- **核心特色**：
  1. 多智能体协同学习对话与资料整理（讲解文档、思维导图、拓展阅读、代码案例）
  2. 互动刷题与错题本（基于 `ask_question` 工具逐题提问、本地精准判题）
  3. 层级对话与探索卡片树（无限下钻、文献术语点击溯源、分支对话）
  4. 思维宇宙（512 维本地确定性语义向量、3D 知识网络、知识锚点注入）
  5. 技能扩展系统（Markdown `SKILL.md` 动态加载与 `use_skill` 工具调用）

---

## 2. 技术栈与环境要求

- **运行环境**：Node.js >= **22.5.0**（利用原生 `node:sqlite` 与 `--experimental-strip-types` 原生 TS 执行能力）
- **前端技术**：React 18 · TypeScript · Vite 5 · Tailwind CSS · Zustand · react-force-graph-3d · KaTeX · Mermaid
- **服务端技术**：Node.js 原生 HTTP & SSE · 原生 `node:sqlite` · esbuild 打包 · 原生 `node:test` 测试套件
- **模型支持**：任意 OpenAI 兼容端点（Base URL + API Key + Model Name，由前端 LocalStorage 持久化，随请求透传）

---

## 3. 项目目录结构

```text
IndexNya/
├── src/                          # 统一应用源码目录
│   ├── components/               # React UI 组件
│   │   ├── chat/                 # 对话气泡、Markdown 渲染、模型/推理强度选择器
│   │   ├── explore/              # 探索卡片坞（ExploreDock / ExploreCard）
│   │   ├── layout/               # AppShell 侧边栏与主布局
│   │   ├── settings/             # 设置弹窗（模型提供商、外观、技能、数据备份）
│   │   └── ui/                   # 基础 UI 控件（button, input, card, badge 等）
│   ├── pages/                    # 路由页面
│   │   ├── ChatPage.tsx          # 学习对话主页
│   │   ├── PracticePage.tsx      # 错题本与刷题记录
│   │   ├── LiteraturePage.tsx    # 文献导入与术语抽取
│   │   └── UniversePage.tsx      # 思维宇宙 3D 图谱
│   ├── stores/                   # 客户端状态管理（Zustand persist）
│   │   └── app.ts                # 对话 ID、模型提供商、主题、卡片坞状态
│   ├── lib/                      # 前端实用工具
│   │   ├── api.ts                # 同源 REST & SSE 请求客户端
│   │   ├── explore.ts            # 卡片下钻调度逻辑
│   │   └── theme.ts              # 外观主题与主色动态计算
│   └── runtime/                  # TypeScript 全栈服务端运行时
│       ├── index.ts              # 生产启动入口（托管静态资源与 API）
│       ├── dev.ts                # 开发模式入口（集成 Vite middleware）
│       ├── runtime.ts            # Node HTTP 调度、静态托管、CORS、SSE 流
│       ├── api.ts                # REST 接口与 Multipart 表单路由
│       ├── db.ts                 # SQLite 连接、建表 Schema 与轻量迁移
│       ├── repository.ts         # 数据库 CRUD 与领域实体映射
│       ├── llm.ts                # OpenAI 兼容接口封装、SSE 流解析、连接测试
│       ├── chat.ts               # 需求确定、对话流分发、互动刷题状态机
│       ├── hierarchy.ts          # 探索卡片流式生成与卡片树管理
│       ├── agents.ts             # 资源生成、智能辅导、启发式术语抽取
│       ├── universe.ts           # 512 维特征哈希嵌入、余弦相似度、图构建
│       ├── literature.ts         # PDF/TXT/Markdown 文本提取与重叠分块
│       ├── skills.ts             # 技能解析、ZIP 安装/卸载、全局开关
│       ├── quiz.ts               # 互动刷题判定、容错提取与小结生成
│       ├── data.ts               # session log 全量备份恢复与 Markdown 笔记导出
│       └── tests/                # 单元测试（core.test.ts）
├── public/                       # 静态资源（favicon 等）
├── scripts/                      # 辅助构建脚本（build-server.mjs）
├── data/                         # 运行时数据目录（自动生成，不入 Git）
│   ├── learning_agent.db         # 本地 SQLite 数据库文件
│   ├── skills.json               # 技能开关配置
│   └── skills/                   # 用户上传安装的自定义技能
├── .github/workflows/ci.yml      # CI 工作流（Install, build & typecheck）
├── package.json                  # 项目统一依赖与 npm 脚本
├── tsconfig.json                 # 客户端 TypeScript 配置
├── tsconfig.server.json          # 服务端 TypeScript 配置
├── vite.config.ts                # Vite 配置
├── start.sh / start.ps1          # 一键启动脚本（macOS/Linux 与 Windows）
└── LICENSE                       # GPL-3.0 开源许可证
```

---

## 4. 核心系统与工作流设计

### 4.1 低等待对话分发（Fast Routing）
对话流遵循「三层递进，命中即止」原则：
1. **显式指定**：用户点击快捷动作（讲解文档/思维导图/刷题模式）直接确定动作。
2. **关键词快速路由**：正则匹配常见生成意图（如“生成讲解文档”、“画思维导图”、“考考我”），零 LLM 消耗快速路由。
3. **轻量意图判定**：未命中时调用小 prompt 判定 JSON（action / resource_type / topic）。
4. **流式交付**：内容流生成完毕立刻落库并返回 `done` 事件，术语抽取与验收后置并行处理，保证用户界面零停滞。

### 4.2 互动刷题（Interactive Quiz）
- 模型通过 `ask_question` 工具逐题出题。
- 每轮作答优先通过本地规则（选项比对、文本归一化）精准判定对错，并立即回填错题本 `practice_records`。
- 会话状态持久化在消息元数据 `meta.quiz_session` 中，支持随时中断、重发继续或一键重练。

### 4.3 思维宇宙（Thought Universe）
- 概念嵌入采用 **512 维特征哈希词袋向量（L2 归一化）**，完全本地离线运行、确定可比。
- 3D 知识图谱根据节点相似度阈值构建拓扑关系；新对话与资源生成时自动检索并注入已掌握的**知识锚点**。

### 4.4 技能系统（Skills）
- 技能以 `SKILL.md`（含 YAML frontmatter）格式存储。
- 系统提示词仅注入技能清单（名称+简短描述）；当任务匹配时，模型调用 `use_skill` 工具按需加载完整执行指令。

---

## 5. 常用开发与测试指令

```bash
# 1. 安装项目依赖
npm install

# 2. 启动开发模式（单进程：Vite HMR + 同源 /api）
npm run dev

# 3. 静态类型检查（前端与服务端）
npm run typecheck

# 4. 执行自动化测试
npm run test

# 5. 生产构建（前端 Vite + 服务端 esbuild 单文件打包）
npm run build

# 6. 生产运行
npm run start
```

---

## 6. Agent 协作规范与注意事项

1. **单进程同源约定**：前端与后端运行在同一个 Node 进程上，所有服务端接口均位于 `/api/*`，禁止引入额外的外部后端代理。
2. **本地优先与无损降级**：当未配置 LLM API Key 时，各功能（资源生成、对话、刷题、思维宇宙、术语抽取）必须提供确定的本地 fallback，确保离线与测试始终可用。
3. **数据持久化规范**：
   - 用户数据一律保存在 `data/learning_agent.db`。
   - 数据操作使用 `src/runtime/repository.ts` 与 `src/runtime/db.ts` 中的同步事务/查询方法，保持数据一致性。
4. **Git Commit 规范**：
   - 提交前缀必须带有 Type，如：`feat:`、`fix:`、`refactor:`、`docs:`、`ci:`。
   - 修改代码后务必保持 `npm run typecheck` 与 `npm run test` 全部通过。
