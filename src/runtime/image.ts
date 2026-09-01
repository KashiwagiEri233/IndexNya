import type { ModelConfig } from "./types.ts";
import { chatCompleteText, hasUsableModel } from "./llm.ts";

export const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
export const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

const SYSTEM_PROMPT = `你是一位图片理解辅导智能体。学生会上传题目、图表、代码截图或教学插图并提出问题。
先简要描述图片关键信息，再针对问题给出结构化中文解答；信息不足时明确说明。`;

export async function understandImage(image: Buffer, question: string, contentType: string, model?: ModelConfig): Promise<Record<string, unknown>> {
  const prompt = question || "请描述这张图片并解释相关知识点";
  if (!hasUsableModel(model)) {
    return { recognition: null, answer: "当前没有配置支持图片输入的模型，请在设置中选择一个视觉模型后重试。", question: prompt, status: "failed", error: "未配置可用模型" };
  }
  try {
    const dataUrl = `data:${contentType};base64,${image.toString("base64")}`;
    const answer = await chatCompleteText(model, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] },
    ], { temperature: 0.5, maxTokens: 2048 });
    if (!answer.trim()) return { recognition: null, answer: null, question: prompt, status: "failed", error: "模型没有返回有效内容（当前模型可能不支持图片输入）" };
    return { recognition: null, answer, question: prompt, status: "completed", error: null };
  } catch (error) {
    return { recognition: null, answer: null, question: prompt, status: "failed", error: `图片理解失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
