# Index 学习岛

> 面向大学生的学习记录、资料整理与路径规划工具
> 技术栈：React + FastAPI

## 功能

1. **学习对话与记录** — 通过对话梳理专业方向、学习目标和当前难点
2. **学习资料整理** — 生成讲解文档、思维导图、练习题、拓展阅读、代码案例和插图；需要视频时提供 Bilibili 相关视频链接
3. **学习路径规划** — 根据学习目标和已有资料拆解学习步骤与先后关系
4. **多种答疑方式** — 支持文字、图片、图解，并可推荐 Bilibili 相关视频
5. **学习反馈** — 记录学习过程，查看阶段性进展和待改进的部分

## 技术栈

- **后端**：Python 3.12 · FastAPI · SQLAlchemy 2 · SQLite
- **前端**：Vite · React 18 · TypeScript · Tailwind · shadcn/ui
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
后端 agents/        — 讲解、导图、题库、阅读、代码等内容模块
后端 llm/           — OpenAI 兼容接口封装，按配置切换模型
后端 tools/         — 图像生成与文件处理
前端 pages/         — Chat / Profile / Resources / Path / Dashboard
```

详见各目录 README。
