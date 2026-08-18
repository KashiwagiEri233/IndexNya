/** 探索卡片驱动器 — 两阶段流程：先打开提问编辑态，点发送后再请求 LLM。 */
import { api, type CardRow, type ChatTerm, type ExploreCardPayload, type ExploreMode } from "@/lib/api";
import { useAppStore, requestModelOf, resolveModelEntry, resolveSelectedModel, type SelectedModelEntry, type ExploreCardState } from "@/stores/app";

export interface OpenExploreOptions {
  term: string;
  explanation?: string;
  context?: string;
  mode?: ExploreMode;
  conversationId?: number;
  sourceMessageId?: number;
  parentCardId?: number;
  parentKey?: string;
  cardId?: number;
  modelId?: string;
  branchConversationId?: number;
}

export function resolveModel(modelId?: string): SelectedModelEntry | undefined {
  const state = useAppStore.getState();
  const key = modelId ?? state.selectedModelKey;
  return resolveModelEntry(state.providers, key)
    ?? resolveSelectedModel({ providers: state.providers, selectedModelKey: state.selectedModelKey });
}

function toModelPayload(model?: SelectedModelEntry) {
  return requestModelOf(model);
}

function patchCard(key: string, patch: Partial<ExploreCardState>) {
  useAppStore.getState().explorePatch(key, patch);
}

function updateLastAssistant(key: string, update: (m: ExploreCardState["messages"][number]) => ExploreCardState["messages"][number]) {
  const cards = useAppStore.getState().exploreCards;
  const card = cards.find((c) => c.key === key);
  if (!card) return;
  const messages = [...card.messages];
  const index = messages.length - 1;
  if (index >= 0) messages[index] = update(messages[index]);
  patchCard(key, { messages });
}

/**
 * 阶段一：打开一张探索卡片（提问编辑态，不请求 LLM）。
 * 点击名词 / 选中文本追问 / 侧边栏重开都走这里；用户补充问题后由 startExploreCard 发起生成。
 */
/** 打开一张探索卡片（提问编辑态，不请求 LLM）。 */
export function openExploreCard(opts: OpenExploreOptions): string | null {
  const state = useAppStore.getState();
  const key = crypto.randomUUID();
  const mode = opts.mode ?? "child";
  state.exploreAdd({
    key,
    cardId: opts.cardId,
    term: opts.term,
    explanation: opts.explanation,
    context: opts.context ?? "",
    mode,
    conversationId: opts.conversationId,
    branchConversationId: opts.branchConversationId,
    sourceMessageId: opts.sourceMessageId,
    parentCardId: opts.parentCardId,
    parentKey: opts.parentKey,
    modelId: opts.modelId ?? state.selectedModelKey,
    status: "pending",
    messages: [],
  });
  return key;
}

/**
 * 恢复一张已生成的卡片（关闭后重开）：直接显示服务端保存的先前回复，
 * 不重新请求 LLM。分支卡片会异步拉取分支对话全量历史。
 */
export async function restoreExploreCard(row: CardRow): Promise<string | null> {
  const state = useAppStore.getState();
  const key = crypto.randomUUID();
  const saved = row.content?.messages ?? [];
  let messages: { role: "user" | "assistant"; content: string; streaming?: boolean; terms?: ChatTerm[] }[] = saved.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
    content: m.content,
    terms: Array.isArray(m.terms) ? (m.terms as ChatTerm[]) : undefined,
  }));
  if (messages.length === 0) {
    messages = [{ role: "assistant" as const, content: "", streaming: false }];
  }
  state.exploreAdd({
    key,
    cardId: row.id,
    term: row.term,
    context: row.context,
    mode: row.type,
    conversationId: row.conversation_id ?? undefined,
    branchConversationId: row.branch_conversation_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    parentCardId: row.parent_card_id ?? undefined,
    modelId: state.selectedModelKey,
    status: "done",
    messages,
  });
  // 分支卡片：用分支对话的真实历史覆盖（包含后续追问）
  if (row.branch_conversation_id) {
    try {
      const rows = await api.getMessages(row.branch_conversation_id);
      const history = rows.map((m: any) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
        terms: Array.isArray(m.meta?.terms) ? (m.meta.terms as ChatTerm[]) : undefined,
      }));
      if (history.length > 0) {
        useAppStore.getState().explorePatch(key, { messages: history });
      }
    } catch {
      /* 历史拉取失败时保留 content 中的内容 */
    }
  }
  return key;
}

/** 阶段二：用户点发送后，按补充的问题发起 SSE 生成。question 为空时使用默认讲解。 */
export async function startExploreCard(key: string, question: string): Promise<void> {
  const state = useAppStore.getState();
  const card = state.exploreCards.find((c) => c.key === key);
  if (!card) return;
  const model = resolveModel(card.modelId);
  if (!model) {
    alert("请先添加并选择一个对话模型，再发送。");
    return;
  }
  patchCard(key, { status: "opening", error: undefined });

  const payload: ExploreCardPayload = {
    term: card.term,
    explanation: card.explanation,
    context: card.context,
    mode: card.mode,
    conversation_id: card.conversationId,
    source_message_id: card.sourceMessageId,
    parent_card_id: card.parentCardId,
    card_id: card.cardId,
    seed_message: question.trim() || undefined,
    model: toModelPayload(model),
  };

  try {
    await api.exploreCard(payload, {
      onMeta: async (d) => {
        const metaPatch: Partial<ExploreCardState> = { cardId: d.card_id, status: "streaming" };
        if (d.branch_conversation_id) metaPatch.branchConversationId = d.branch_conversation_id;
        patchCard(key, metaPatch);
        if (d.branch_conversation_id) {
          try {
            const rows = await api.getMessages(d.branch_conversation_id);
            const history = rows.map((m: any) => ({
              role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
              content: m.content,
              terms: Array.isArray(m.meta?.terms) ? (m.meta.terms as ChatTerm[]) : undefined,
            }));
            patchCard(key, { messages: [...history, { role: "assistant", content: "", streaming: true }] });
          } catch {
            patchCard(key, { messages: [{ role: "assistant", content: "", streaming: true }] });
          }
        } else {
          patchCard(key, { messages: [{ role: "assistant", content: "", streaming: true }] });
        }
      },
      onToken: (t) => updateLastAssistant(key, (m) => ({ ...m, content: m.content + t })),
      onTerms: (d) => updateLastAssistant(key, (m) => ({ ...m, terms: Array.isArray(d.terms) ? d.terms : [] })),
      onDone: () => {
        patchCard(key, { status: "done" });
        updateLastAssistant(key, (m) => ({ ...m, streaming: false }));
        useAppStore.getState().bumpCards();
      },
      onError: (msg) => {
        // 只记录错误状态，不覆盖已有内容（避免重新生成失败时旧回答被错误信息顶掉）
        patchCard(key, { status: "error", error: msg });
      },
    });
  } catch (e: any) {
    patchCard(key, { status: "error", error: e.message });
  }
}

/** 重置卡片为提问编辑态（重新生成时使用），保留已有回答供参考。 */
export function resetExploreCard(key: string) {
  useAppStore.getState().explorePatch(key, { status: "pending", error: undefined });
}

/**
 * 切换卡片模式（↗️ 深挖 / ➡️ 对比 / ⬇️ 分支）。
 * 保留已有回答（messages 不清空）：切换后回到提问态但旧内容仍可见，
 * 发送新问题后由新回答替换。
 */
export function switchExploreMode(key: string, mode: ExploreMode) {
  const card = useAppStore.getState().exploreCards.find((c) => c.key === key);
  if (!card || card.mode === mode) return;
  useAppStore.getState().explorePatch(key, {
    mode,
    status: "pending",
    error: undefined,
  });
}

/** 分支卡片内继续追问（真实分支对话）。 */
export async function sendBranchMessage(key: string, text: string) {
  const state = useAppStore.getState();
  const card = state.exploreCards.find((c) => c.key === key);
  if (!card || !card.branchConversationId) return;
  const model = resolveModel(card.modelId);
  if (!model) {
    alert("请先添加并选择一个对话模型。");
    return;
  }
  const current = useAppStore.getState().exploreCards.find((c) => c.key === key);
  const messages = [
    ...(current?.messages ?? []),
    { role: "user" as const, content: text },
    { role: "assistant" as const, content: "", streaming: true },
  ];
  patchCard(key, { messages, status: "streaming", error: undefined });
  try {
    await api.chatStream(
      {
        conversation_id: card.branchConversationId,
        message: text,
        model: toModelPayload(model),
        context: `当前分支聚焦术语：${card.term}`,
      },
      {
        onToken: (t) => updateLastAssistant(key, (m) => ({ ...m, content: m.content + t })),
        onTerms: (d) => updateLastAssistant(key, (m) => ({ ...m, terms: Array.isArray(d.terms) ? d.terms : [] })),
        onDone: () => {
          patchCard(key, { status: "done" });
          updateLastAssistant(key, (m) => ({ ...m, streaming: false }));
        },
        onError: (msg) => {
          // 只记录错误状态，不覆盖最后一条消息内容
          patchCard(key, { status: "error", error: msg });
        },
      }
    );
  } catch (e: any) {
    patchCard(key, { status: "error", error: e.message });
  }
}
