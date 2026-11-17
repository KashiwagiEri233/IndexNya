/**
 * 每日一题：抓取 LeetCode 中国站与牛客竞赛的每日题目，并提供标签随机推荐。
 * 网络不可用时回退到 SQLite 当日缓存或内置题目，保证离线可用。
 */
import type { Database } from "./db.ts";
import { nowIso, parseJson } from "./db.ts";
import { HttpError } from "./errors.ts";

export type DailySource = "leetcode" | "nowcoder";
export type DailyDifficulty = "简单" | "中等" | "困难" | "未知";

export interface DailyTag {
  name: string;
  slug: string;
}

export interface DailyCodeSnippet {
  lang: string;
  langSlug: string;
  code: string;
}

export interface DailyProblem {
  source: DailySource;
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  difficulty: DailyDifficulty;
  tags: DailyTag[];
  contentHtml: string;
  url: string;
  date: string;
  fetchedAt: string;
  codeSnippets?: DailyCodeSnippet[];
  /** 展示的是本地缓存（当日抓取失败） */
  stale?: boolean;
  /** 展示的是内置兜底题目 */
  offline?: boolean;
  note?: string;
}

export interface DailyProblemSummary {
  source: DailySource;
  id: string;
  slug: string;
  title: string;
  difficulty: DailyDifficulty;
  tags: DailyTag[];
}

const LC_GRAPHQL = "https://leetcode.cn/graphql/";
const LC_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://leetcode.cn",
  Referer: "https://leetcode.cn/problemset/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

const NC_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

/** 牛客「每日一题」题单（二期），按日期在其中轮换一道题。 */
const NC_COLLECTION_URL = "https://ac.nowcoder.com/acm/problem/collection/566";

const LC_DAILY_QUERY = `query questionOfToday {
  todayRecord {
    date
    question {
      questionFrontendId
      title
      translatedTitle
      titleSlug
      difficulty
      content
      translatedContent
      topicTags { name slug }
      codeSnippets { lang langSlug code }
    }
  }
}`;

const LC_DETAIL_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    titleSlug
    difficulty
    content
    translatedContent
    topicTags { name slug }
    codeSnippets { lang langSlug code }
  }
}`;

const LC_LIST_QUERY = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug limit: $limit skip: $skip filters: $filters) {
    total
    questions {
      frontendQuestionId
      title
      titleCn
      titleSlug
      difficulty
      topicTags { name slug }
    }
  }
}`;

export function beijingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function difficultyLabel(value: string | null | undefined): DailyDifficulty {
  const text = String(value || "").toLowerCase();
  if (text === "easy" || text === "简单") return "简单";
  if (text === "medium" || text === "中等") return "中等";
  if (text === "hard" || text === "困难") return "困难";
  return "未知";
}

function ratingDifficulty(rating: number | undefined): DailyDifficulty {
  if (!rating) return "未知";
  if (rating >= 2400) return "困难";
  if (rating >= 1800) return "中等";
  return "简单";
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeSource(value: string | null | undefined): DailySource {
  return value === "nowcoder" ? "nowcoder" : "leetcode";
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new HttpError(502, `抓取失败：HTTP ${response.status}`);
  return response.text();
}

async function lcQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
  operationName?: string,
): Promise<T> {
  const response = await fetch(LC_GRAPHQL, {
    method: "POST",
    headers: LC_HEADERS,
    body: JSON.stringify({ operationName, variables, query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new HttpError(502, `LeetCode 请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    const detail = payload.errors.map((item) => item.message).filter(Boolean).join("；");
    throw new HttpError(502, `LeetCode 返回错误：${detail || "未知错误"}`);
  }
  if (!payload.data) throw new HttpError(502, "LeetCode 返回数据为空");
  return payload.data;
}

interface LcQuestionNode {
  questionFrontendId: string;
  title: string;
  translatedTitle?: string | null;
  titleSlug: string;
  difficulty: string;
  content?: string | null;
  translatedContent?: string | null;
  topicTags?: Array<{ name: string; slug: string }> | null;
  codeSnippets?: Array<{ lang: string; langSlug: string; code: string }> | null;
}

function mapLeetCodeQuestion(question: LcQuestionNode, date: string): DailyProblem {
  const title = question.translatedTitle || question.title;
  return {
    source: "leetcode",
    id: question.questionFrontendId,
    slug: question.titleSlug,
    title,
    subtitle: question.translatedTitle ? question.title : undefined,
    difficulty: difficultyLabel(question.difficulty),
    tags: (question.topicTags ?? []).map((tag) => ({ name: tag.name, slug: tag.slug })),
    contentHtml: question.translatedContent || question.content || "<p>暂无题目描述</p>",
    url: `https://leetcode.cn/problems/${question.titleSlug}/`,
    date,
    fetchedAt: nowIso(),
    codeSnippets: (question.codeSnippets ?? []).map((item) => ({
      lang: item.lang,
      langSlug: item.langSlug,
      code: item.code,
    })),
  };
}

async function fetchLeetCodeDaily(date: string): Promise<DailyProblem> {
  const data = await lcQuery<{ todayRecord: Array<{ date: string; question: LcQuestionNode }> }>(
    LC_DAILY_QUERY,
    {},
    "questionOfToday",
  );
  const record = data.todayRecord?.[0];
  if (!record?.question) throw new HttpError(502, "LeetCode 今日题目暂不可用");
  return mapLeetCodeQuestion(record.question, record.date || date);
}

async function fetchLeetCodeDetail(slug: string): Promise<DailyProblem> {
  const data = await lcQuery<{ question: LcQuestionNode | null }>(
    LC_DETAIL_QUERY,
    { titleSlug: slug },
    "questionData",
  );
  if (!data.question) throw new HttpError(404, "题目不存在");
  return mapLeetCodeQuestion(data.question, beijingDate());
}

interface LcListQuestion {
  frontendQuestionId: string;
  title: string;
  titleCn?: string | null;
  titleSlug: string;
  difficulty: string;
  topicTags?: Array<{ name: string; slug: string }> | null;
}

async function fetchLeetCodeRecommendations(
  tags: string[],
  exclude: string,
  limit: number,
): Promise<DailyProblemSummary[]> {
  const filters = tags.length ? { tags: tags.slice(0, 2) } : {};
  const data = await lcQuery<{
    problemsetQuestionList: { total: number; questions: LcListQuestion[] };
  }>(LC_LIST_QUERY, { categorySlug: "", skip: 0, limit: 30, filters }, "problemsetQuestionList");
  const items = (data.problemsetQuestionList?.questions ?? [])
    .filter((item) => item.frontendQuestionId !== exclude)
    .map((item) => ({
      source: "leetcode" as const,
      id: item.frontendQuestionId,
      slug: item.titleSlug,
      title: item.titleCn || item.title,
      difficulty: difficultyLabel(item.difficulty),
      tags: (item.topicTags ?? []).map((tag) => ({ name: tag.name, slug: tag.slug })),
    }));
  return shuffle(items).slice(0, limit);
}

interface NowcoderPoolItem {
  id: string;
  title: string;
  difficulty: DailyDifficulty;
  tags: DailyTag[];
}

let nowcoderPoolCache: { at: number; items: NowcoderPoolItem[] } | null = null;

export function parseNowcoderCollection(html: string): NowcoderPoolItem[] {
  const items: NowcoderPoolItem[] = [];
  const rowPattern = /<tr data-problemId="(\d+)">([\s\S]*?)<\/tr>/g;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(html))) {
    const [, id, row] = match;
    const titleMatch = row.match(/class="title"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const tags: DailyTag[] = [];
    const tagPattern = /class="tag-label js-tag"[^>]*>([\s\S]*?)<\/a>/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagPattern.exec(row))) {
      const name = stripTags(tagMatch[1]);
      if (name) tags.push({ name, slug: name });
    }
    const ratingMatch = row.match(/<td>\s*(\d{3,4})\s*<\/td>/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
    items.push({
      id,
      title: stripTags(titleMatch[1]),
      difficulty: ratingDifficulty(rating),
      tags,
    });
  }
  return items;
}

export function parseNowcoderDetail(html: string, id: string): { title: string; contentHtml: string } {
  const titleMatch = html.match(/<div class="question-title">([\s\S]*?)<\/div>/);
  const title = titleMatch ? stripTags(titleMatch[1].replace(/<i[^>]*>[\s\S]*?<\/i>/g, "")) : `NC${id}`;
  const start = html.indexOf('<div class="terminal-topic">');
  const end = html.indexOf('<div class="js-right', start);
  let content = start >= 0 ? html.slice(start, end > start ? end : undefined) : "";
  content = content
    .replace(/<textarea[\s\S]*?<\/textarea>/g, "")
    .replace(/<a[^>]*class="code-copy-btn[^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<a[^>]*class="icon-fullscreen[^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<a[^>]*class="icon-resize-small[^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<h2 class="subject-item-title">[\s\S]*?<\/h2>/g, "");
  if (!content) content = `<p>暂时无法解析题目详情，可前往牛客查看原题。</p>`;
  return { title, contentHtml: content };
}

async function loadNowcoderPool(force = false): Promise<NowcoderPoolItem[]> {
  const fresh = nowcoderPoolCache && Date.now() - nowcoderPoolCache.at < 6 * 60 * 60 * 1000;
  if (fresh && !force) return nowcoderPoolCache!.items;
  const items: NowcoderPoolItem[] = [];
  for (const page of [1, 2]) {
    const query = page === 1 ? "" : "?page=2";
    const html = await fetchText(`${NC_COLLECTION_URL}${query}`, NC_HEADERS);
    items.push(...parseNowcoderCollection(html));
  }
  if (!items.length) throw new HttpError(502, "牛客每日一题题单解析失败");
  nowcoderPoolCache = { at: Date.now(), items };
  return items;
}

function dayNumber(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
}

async function fetchNowcoderProblem(id: string): Promise<DailyProblem & { item?: NowcoderPoolItem }> {
  const html = await fetchText(`https://ac.nowcoder.com/acm/problem/${id}`, NC_HEADERS);
  const detail = parseNowcoderDetail(html, id);
  return {
    source: "nowcoder",
    id,
    slug: id,
    title: detail.title,
    difficulty: "未知",
    tags: [],
    contentHtml: detail.contentHtml,
    url: `https://ac.nowcoder.com/acm/problem/${id}`,
    date: beijingDate(),
    fetchedAt: nowIso(),
  };
}

async function fetchNowcoderDaily(date: string): Promise<DailyProblem> {
  const pool = await loadNowcoderPool();
  const item = pool[dayNumber(date) % pool.length];
  const problem = await fetchNowcoderProblem(item.id);
  return {
    ...problem,
    title: problem.title || item.title,
    difficulty: item.difficulty,
    tags: item.tags,
    note: "来自牛客「每日一题」题单，按日期轮换。",
  };
}

async function fetchNowcoderRecommendations(
  tags: string[],
  exclude: string,
  limit: number,
): Promise<DailyProblemSummary[]> {
  const pool = await loadNowcoderPool();
  const candidates = pool.filter((item) => item.id !== exclude);
  const matched = tags.length
    ? candidates.filter((item) => item.tags.some((tag) => tags.includes(tag.name) || tags.includes(tag.slug)))
    : [];
  const picked = shuffle(matched.length ? matched : candidates).slice(0, limit);
  return picked.map((item) => ({
    source: "nowcoder" as const,
    id: item.id,
    slug: item.id,
    title: item.title,
    difficulty: item.difficulty,
    tags: item.tags,
  }));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function readDailyCache(db: Database, source: DailySource, date: string): DailyProblem | undefined {
  const row = db.get<{ payload: string }>(
    "SELECT payload FROM daily_problem_cache WHERE source = ? AND date = ?",
    [source, date],
  );
  return row ? parseJson<DailyProblem | undefined>(row.payload, undefined) : undefined;
}

function writeDailyCache(db: Database, source: DailySource, date: string, problem: DailyProblem): void {
  db.run(
    `INSERT INTO daily_problem_cache (source, date, payload, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(source, date) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
    [source, date, JSON.stringify(problem), nowIso()],
  );
}

/** 无网络且无缓存时的确定性兜底题目（保持功能可用）。 */
function fallbackDaily(source: DailySource, date: string): DailyProblem {
  if (source === "nowcoder") {
    return {
      source,
      id: "18386",
      slug: "18386",
      title: "字符串",
      difficulty: "简单",
      tags: [{ name: "尺取法/双指针", slug: "尺取法/双指针" }, { name: "枚举", slug: "枚举" }],
      contentHtml:
        "<p>牛客每日一题暂时无法联网获取。这里展示内置的入门题：给定一个只包含小写字母的字符串，求最短的包含全部 26 个小写字母的连续子串长度。</p><p>建议先自己思考滑动窗口思路，恢复网络后点击刷新即可获取当日题目。</p>",
      url: "https://ac.nowcoder.com/acm/problem/18386",
      date,
      fetchedAt: nowIso(),
    };
  }
  return {
    source,
    id: "1",
    slug: "two-sum",
    title: "两数之和",
    subtitle: "Two Sum",
    difficulty: "简单",
    tags: [{ name: "数组", slug: "array" }, { name: "哈希表", slug: "hash-table" }],
    contentHtml:
      "<p>给定一个整数数组 <code>nums</code> 和一个整数目标值 <code>target</code>，请你在该数组中找出和为目标值 <code>target</code> 的两个整数，并返回它们的数组下标。</p><p>你可以假设每种输入只会对应一个答案，并且不能重复使用同一个元素。</p>",
    url: "https://leetcode.cn/problems/two-sum/",
    date,
    fetchedAt: nowIso(),
  };
}

export async function getDailyProblem(
  db: Database,
  options: { source?: string; id?: string; slug?: string; refresh?: boolean } = {},
): Promise<DailyProblem> {
  const source = normalizeSource(options.source);
  if (options.slug?.trim() && source === "leetcode") return fetchLeetCodeDetail(options.slug.trim());
  if (options.id?.trim() && source === "nowcoder") return fetchNowcoderProblem(options.id.trim());

  const date = beijingDate();
  const cached = readDailyCache(db, source, date);
  if (cached && !options.refresh) return { ...cached, stale: false };

  try {
    const fresh = source === "leetcode" ? await fetchLeetCodeDaily(date) : await fetchNowcoderDaily(date);
    writeDailyCache(db, source, date, fresh);
    return fresh;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached) return { ...cached, stale: true, note: `网络抓取失败，展示本地缓存：${message}` };
    return { ...fallbackDaily(source, date), offline: true, note: `网络抓取失败，展示内置题目：${message}` };
  }
}

export async function recommendDailyProblems(options: {
  source?: string;
  tags?: string[];
  exclude?: string;
  limit?: number;
}): Promise<{ source: DailySource; items: DailyProblemSummary[]; note?: string }> {
  const source = normalizeSource(options.source);
  const tags = (options.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  try {
    const items =
      source === "leetcode"
        ? await fetchLeetCodeRecommendations(tags, options.exclude || "", limit)
        : await fetchNowcoderRecommendations(tags, options.exclude || "", limit);
    if (!items.length) return { source, items, note: "没有找到同标签的题目，换一个标签试试。" };
    return { source, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { source, items: [], note: `推荐题目获取失败：${message}` };
  }
}
