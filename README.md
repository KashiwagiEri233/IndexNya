# Index 学习岛

> 面向大学生的本地单用户学习工具（数据全部保存在本机，不区分多用户）
> 技术栈：React + FastAPI

## 功能

1. **学习对话与记录** — 通过对话梳理专业方向、学习目标和当前难点，自动记录完整学习过程
2. **学习资料整理** — 生成讲解文档、思维导图、练习题、拓展阅读、代码案例；需要视频时提供 Bilibili 相关视频链接
3. **互动刷题** — 通过 agent 工具（`ask_question`）一题一题地给学生出练习题：出题 → 作答 → 即时批改讲解 → 下一题；支持选择题点选与自由作答，可随时结束并汇总正确率
4. **错题本** — 互动刷题中出过的题目自动入库（题目/选项/答案/解析/对错），可在「错题本」页筛选查看、删除，并可一键「重练错题」回到对话页逐题重做
5. **技能系统** — 技能以 Markdown 指令文件存储（`backend/app/skills/*.md`），在「设置」页可随时**安装、卸载、开启/关闭**（全局开关）；已开启的技能会被 agent 当作工具（`use_skill`）在对话中主动调用，也可在对话页快捷栏点选，或通过自然语言自动路由。安装即生效，无需重启
6. **层级对话（哪里不懂点哪里）** — 点击回答/文献中的术语，卡片在主线旁丝滑展开：
   - ↗️ **子卡片**：深挖背景知识；➡️ **关联卡片**：横向对比发散；⬇️ **分支卡片**：继承上下文另起炉灶
   - 可无限下钻（卡片树持久化，侧边栏随时重开、旧回答不丢失），主线始终清晰可见
   - 支持**选中任意文本追问/引用**，不限于预标注术语；支持导入 **PDF / TXT / Markdown 文献**，正文术语高亮可点
7. **思维宇宙** — 用自己的话总结概念，AI 评审认可后存入个人理解库；所有理解以 **3D 知识网络**呈现，讲解新概念时自动调用你已掌握的理解作为**知识锚点**
8. **多种答疑方式** — 支持文字、图片（上传题目/图表，由多模态模型直接识别解答），并可推荐 Bilibili 相关视频
9. **消息编辑 / 删除 / 引用** — 修改自己的提问、整轮删除（级联清理其探索卡片）、选中文本作为引用随问题发送

## 技术栈

- **后端**：Python 3.12 · FastAPI · SQLAlchemy 2 · SQLite · pypdf（文献解析）
- **前端**：Vite · React 18 · TypeScript · Tailwind · react-force-graph-3d（思维宇宙 3D 图）
- **模型接口**：支持任意 OpenAI 兼容模型，前端可自行添加和切换；图片理解直接复用文本模型的多模态能力（模型需支持 vision 输入），无需单独配置图片服务

## 快速开始

### 1. 配置模型

模型在网页左下角「设置」中配置（添加提供商 + 提供商内选模型），**无需填写任何环境变量 / .env**。

### 2. 后端

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .        # 或 pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 即可使用。

### Windows 一键启动（PowerShell）

```powershell
cd D:\git\IndexNya
.\start.ps1          # 首次自动建虚拟环境、装依赖，然后同时拉起前后端
.\start.ps1 -Refresh # 强制重新安装后端依赖
```

- 需要已安装 **Python 3.12+** 与 **Node.js 18+**（均已加入 PATH）
- 模型在网页左下角「设置」中添加提供商并选择模型，无需 .env
- 按 `Ctrl+C` 退出，脚本会自动关闭前后端进程
- 自定义端口：`.\start.ps1 -BackendPort 8001 -FrontendPort 5174`

> `start.sh` 为 Linux/macOS（或 Git Bash）下的一键脚本；Windows 请使用上面的 `start.ps1`。

## 架构

```
后端 agents/        — 讲解、导图、题库、阅读、代码、辅导、术语抽取（terms.py）
后端 routers/       — chat / tutoring / skills（安装/开关） / practice（错题本） /
                       hierarchy（探索卡片 SSE）/ literature（文献）/ universe（思维宇宙）
后端 services/      — 资源生成、分支对话、互动刷题、本地单用户（student_service）、思维宇宙（嵌入/锚点/图）
后端 skills/        — Markdown 技能文件（backend/app/skills/*.md）+ 全局开关 settings.json
后端 llm/           — OpenAI 兼容接口封装，按配置切换模型；图片理解复用多模态能力
前端 pages/         — Chat / Practice（错题本） / Literature / Universe / Settings
前端 components/    — explore（探索卡片坞：拖动/缩放/提问编辑态/卡片树）
前端 stores/        — zustand 全局状态（对话、模型、探索卡片坞）
```

## 请求处理时序（低等待设计）

对话流先「确定需求」再「调用功能 prompt」，尽量少调模型：

1. **阶段A 确定需求**（递进，命中即止）：显式指定（resource_type / skill / 刷题模式）→ 本地关键词快速路由（讲解文档/思维导图/练习题/互动刷题等常见请求，零 LLM 调用）→ 未命中才走一次轻量意图判定 LLM（小 prompt、只输出一个小 JSON）。
2. **阶段B 调用功能 prompt**：需求确定后才注入对应功能的提示词——资源 agent 的 system prompt、技能 .md 指令、互动刷题（`ask_question` 工具逐题提问）、辅导/对话 prompt；tasks/acceptance 由本地模板生成，不再经 LLM。
3. **流式输出**：内容流结束后立即保存消息并发 `done`（前端光标即刻停止），验收 / 术语抽取在后台并行执行，完成后回填消息 meta 并发出对应 SSE 事件。

互动刷题会话状态（进行到第几题、答对几题、每题答案与解析）持久化在消息 meta 的 `quiz_session` 字段中：同一对话里用户作答后，下一轮自动继续该会话，无需额外接口。

## 扩展技能

两种方式任选：

1. **设置页安装（推荐）**：打开「设置 → 技能管理」，填写名称/标题/描述/指令正文并保存，立即可用；
2. **直接放文件**：在 `backend/app/skills/` 下新建一个 Markdown 文件（支持 frontmatter）：

```markdown
---
name: my_skill            # 技能唯一标识（英文短横线）
title: 我的技能            # 展示名称
description: 一句话说明    # 主 Agent 据此判断何时使用
---
这里是技能的完整执行指令，会注入模型上下文，由模型按指令执行。
```

技能安装即生效（无需重启后端）；在设置页可以随时卸载，或用开关控制是否被 agent 与对话页快捷栏使用。