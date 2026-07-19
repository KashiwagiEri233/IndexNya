"""路由 Agent — 判断用户意图，决定交给哪个智能体处理。

独立实现（不依赖 BaseAgent 的 JSON 模式），用专门 prompt + 严格解析。
输出：{action, resource_type?, topic?}
  action: chat | resource | tutor
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..llm.factory import chat_complete

logger = logging.getLogger(__name__)


class RouterAgent:
    """路由智能体 — 不继承 BaseAgent，独立实现，专注意图分类。

    与资源生成 agent 解耦：只做判断，不生成内容。
    """

    name = "router"

    ROUTE_PROMPT = """你是一个意图分类器。你的唯一任务是判断用户消息应该交给哪个智能体处理。
绝对不要回答用户的问题，只输出一个 JSON 对象。

可选动作 action：
- chat：闲聊、自我介绍、画像构建、学习建议、概念宽泛咨询
- resource：用户明确想要某种学习资料
- tutor：用户提出具体的解题、理解问题求助

resource 时必须填 resource_type：
- lecture：讲解文档（"讲解""讲义""详细讲""系统介绍"）
- mindmap：思维导图（"思维导图""知识结构""梳理框架""脑图"）
- quiz：练习题库（"题目""练习""做题""测试""考试题"）
- reading：拓展阅读（"推荐书""文献""阅读材料""参考资料"）
- code：代码实操（"代码""编程""实现""写程序""示例代码"）
- video：教学视频（"视频""讲解视频""数字人讲"）
- illustration：教学插图（"插图""配图""画个图""示意图"）
- ppt：教学PPT（"PPT""幻灯片""演示文稿"）

topic 字段：资源/答疑的主题（简短，如"二叉树""快速排序"）。

示例：
用户：你好我是大二学生 → {"action":"chat","topic":""}
用户：我是计算机大二学生，想考研浙大 → {"action":"chat","topic":""}
用户：我数据结构比较弱，喜欢看视频学习 → {"action":"chat","topic":""}
用户：帮我生成二叉树的讲解文档 → {"action":"resource","resource_type":"lecture","topic":"二叉树"}
用户：画个数据结构思维导图 → {"action":"resource","resource_type":"mindmap","topic":"数据结构"}
用户：我想做栈和队列的练习题 → {"action":"resource","resource_type":"quiz","topic":"栈和队列"}
用户：什么是动态规划？ → {"action":"tutor","topic":"什么是动态规划"}
用户：写段快速排序代码 → {"action":"resource","resource_type":"code","topic":"快速排序"}
用户：讲排序算法的视频 → {"action":"resource","resource_type":"video","topic":"排序算法"}
用户：推荐几本机器学习书 → {"action":"resource","resource_type":"reading","topic":"机器学习"}
用户：做个神经网络PPT → {"action":"resource","resource_type":"ppt","topic":"神经网络"}
用户：画张卷积神经网络示意图 → {"action":"resource","resource_type":"illustration","topic":"卷积神经网络"}

规则：
1. 只输出 JSON，不要解释、不要 Markdown、不要代码块
2. 模糊时优先 chat
3. topic 要简短（通常 2-10 字）
4. 关键区分：用户"描述自己的学习背景/偏好"（如"喜欢看视频""大二学生"）是 chat；
   用户"要求生成视频"（如"帮我做个视频""生成讲解视频"）才是 resource/video
5. 仅当用户明确要求生成某种资料时才走 resource；否则一律 chat"""

    async def route(
        self,
        message: str,
        profile: dict | None = None,
        history: list[dict] | None = None,
    ) -> dict[str, Any]:
        """分析用户消息，返回路由决策。"""
        msgs: list[dict] = [{"role": "system", "content": self.ROUTE_PROMPT}]
        if history:
            # 只取最近 2 轮（4 条）历史，避免上下文过长
            for h in history[-4:]:
                msgs.append({"role": h.get("role", "user"), "content": str(h.get("content", ""))[:200]})
        msgs.append({
            "role": "user",
            "content": f"判断这条用户消息应该交给哪个智能体，只输出 JSON：\n用户消息：{message}",
        })

        try:
            text = await chat_complete(msgs, temperature=0.0, max_tokens=200)
        except Exception as e:
            logger.warning("router LLM call failed: %s, fallback to chat", e)
            return {"action": "chat", "topic": ""}

        return self._parse(text, message)

    def _parse(self, text: str, original_message: str) -> dict[str, Any]:
        """从 LLM 输出解析路由 JSON，失败时兜底。"""
        cleaned = text.strip()
        # 去掉 ```json ... ``` 包裹
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(1)
        else:
            # 提取首个 { 到末尾 }
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end > start:
                cleaned = cleaned[start : end + 1]
            elif start != -1:
                # 输出被截断（max_tokens 不够），尝试自动补全
                fragment = cleaned[start:]
                # 去掉末尾不完整的 "xxx（无闭合引号）
                fragment = re.sub(r'"[^"]*$', '', fragment)
                # 补全缺失的 }
                if fragment.count("{") > fragment.count("}"):
                    fragment += "}" * (fragment.count("{") - fragment.count("}"))
                cleaned = fragment

        try:
            data = json.loads(cleaned)
        except Exception:
            logger.warning("router parse failed, raw: %s", text[:200])
            return {"action": "chat", "topic": ""}

        action = str(data.get("action", "chat")).lower()
        if action not in ("chat", "resource", "tutor"):
            action = "chat"

        topic = str(data.get("topic", "") or "").strip()
        # topic 为空时用原始消息兜底（截断）
        if not topic and action in ("resource", "tutor"):
            topic = original_message[:20]

        result: dict[str, Any] = {"action": action, "topic": topic}
        if action == "resource":
            rtype = str(data.get("resource_type", "")).lower()
            valid = {"lecture", "mindmap", "quiz", "reading", "code", "video", "illustration", "ppt"}
            result["resource_type"] = rtype if rtype in valid else "lecture"
        return result
