# Index 学习岛

> 面向大学生的学习记录、资料整理与路径规划工具
> 技术栈：React + FastAPI

## 功能

1. **学习对话与记录** — 通过对话梳理专业方向、学习目标和当前难点，自动构建动态学习画像
2. **学习资料整理** — 生成讲解文档、思维导图、练习题、拓展阅读、代码案例、插图与教学 PPT；需要视频时提供 Bilibili 相关视频链接
3. **层级对话（哪里不懂点哪里）** — 点击回答/文献中的术语，卡片在主线旁丝滑展开：
   - ↗️ **子卡片**：深挖背景知识；➡️ **关联卡片**：横向对比发散；⬇️ **分支卡片**：继承上下文另起炉灶
   - 可无限下钻（卡片树持久化，侧边栏随时重开、旧回答不丢失），主线始终清晰可见
   - 支持**选中任意文本追问/引用**，不限于预标注术语；支持导入 **PDF / TXT / Markdown 文献**，正文术语高亮可点
4. **思维宇宙** — 用自己的话总结概念，AI 评审认可后存入个人理解库；所有理解以 **3D 知识网络**呈现，讲解新概念时自动调用你已掌握的理解作为**知识锚点**
5. **学习路径规划** — 根据学习目标和已有资料拆解学习步骤与先后关系
6. **多种答疑方式** — 支持文字、图片（上传题目/图表识别）、图解，并可推荐 Bilibili 相关视频
7. **学习反馈** — 记录学习过程，查看阶段性进展和待改进的部分
8. **消息编辑 / 删除 / 引用** — 修改自己的提问、整轮删除（级联清理其探索卡片）、选中文本作为引用随问题发送

## 技术栈

- **后端**：Python 3.12 · FastAPI · SQLAlchemy 2 · SQLite · pypdf（文献解析）
- **前端**：Vite · React 18 · TypeScript · Tailwind · react-force-graph-3d（思维宇宙 3D 图）
- **模型接口**：支持任意 OpenAI 兼容模型，前端可自行添加和切换；PPT 使用本地模板生成
- **图像**：兼容 OpenAI DALL·E 协议

## 快速开始

### 1. 配置密钥

```bash
cp .env.example .env
# 按需填入图片等服务的凭证
```

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
- 首次运行会自动从 `.env.example` 生成 `.env`；也可以在网页左下角「设置」中添加模型，二选一即可
- 按 `Ctrl+C` 退出，脚本会自动关闭前后端进程
- 自定义端口：`.\start.ps1 -BackendPort 8001 -FrontendPort 5174`

> `start.sh` 为 Linux/macOS（或 Git Bash）下的一键脚本；Windows 请使用上面的 `start.ps1`。

## 架构

```
后端 agents/        — 讲解、导图、题库、阅读、代码、辅导、画像、术语抽取（terms.py）
后端 routers/       — chat / resources / paths / tutoring / assessment /
                       hierarchy（探索卡片 SSE）/ literature（文献）/ universe（思维宇宙）
后端 services/      — 资源生成、画像、路径、评估、分支对话、思维宇宙（嵌入/锚点/图）
后端 llm/           — OpenAI 兼容接口封装，按配置切换模型
后端 tools/         — 图像生成、讯飞图片理解鉴权、本地 PPT
前端 pages/         — Chat / Profile / Resources / Path / Dashboard /
                       Literature / Universe / Settings
前端 components/    — explore（探索卡片坞：拖动/缩放/提问编辑态/卡片树）
前端 stores/        — zustand 全局状态（学生、对话、模型、探索卡片坞）
```
