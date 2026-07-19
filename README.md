# Index-学习智能助手

> 面向大学生的多智能体个性化学习资源生成系统
> 技术栈：React + FastAPI，UI 对齐 Claude 网页端

## 功能

1. **对话式学习画像自主构建** — 自然语言对话自动抽取特征，构建 8 维度动态学生画像
2. **多智能体协同资源生成** — 7 类角色 agent 协作生成讲解文档/思维导图/题库/拓展阅读/代码案例/教学视频/教学插图
3. **个性化学习路径规划** — 多智能体整合资源，规划动态学习步骤与依赖
4. **智能辅导（加分）** — 多模态答疑：文字 + 图解 + 数字人视频讲解
5. **学习效果评估（加分）** — 跟踪学习行为，多维度精准评估并动态调整推送

## 技术栈

- **后端**：Python 3.12 · FastAPI · SQLAlchemy 2 · SQLite
- **前端**：Vite · React 18 · TypeScript · Tailwind · shadcn/ui
- **LLM**：讯飞星火 X2（OpenAI 兼容协议，`/x2/chat/completions`，model 字段填 `spark-x`，可切换 provider）
- **视频**：讯飞数字人视频生成 API
- **图像**：兼容 OpenAI DALL·E 协议

## 快速开始

### 1. 配置密钥

```bash
cp .env.example .env
# 填入讯飞 APIPassword、AppID、APIKey、APISecret
```

### 2. 后端

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 即可使用。

## 架构

```
后端 agents/        — 多智能体（profiler/lecturer/mindmap/quizmaster/
                      reader/coder/videoist/illustrator/pathplanner/tutor）
后端 llm/          — OpenAI 兼容封装，按 .env 切换 provider
后端 tools/        — 讯飞视频、图像生成、画像存储
前端 pages/        — Chat / Profile / Resources / Path / Dashboard
```

详见各目录 README。
