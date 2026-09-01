/**
 * 主题应用工具：浅色 / 深色 / 跟随系统 + 用户自定义主色。
 *
 * 设计：
 * - 深色模式通过 <html class="dark"> 切换，样式集中在 globals.css 的 .dark 块。
 * - 主色同时驱动 accent* 一族（hover/active/deep/soft 由主色换算）与
 *   中性表面/文字/描边（bg/card/panel/ink/border… 按比例向主色混合），
 *   让背景、卡片、文字、描边随主色一起变色；粉彩 / 状态色 / 代码块等
 *   语义色保持每套主题的默认值。
 * - 所有 color 值写成 "r g b"（RGB 三元组），供 Tailwind 的
 *   `rgb(var(--island-xxx) / <alpha-value>)` 引用。
 */
import type { ThemeMode } from "@/stores/app";

interface RGB {
  r: number;
  g: number;
  b: number;
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };
/** 深色主题下的背景基准色（近似 --island-bg），用于计算 soft 底 */
const DARK_BG: RGB = { r: 23, g: 21, b: 15 };

const ACCENT_VARS = [
  "--island-accent",
  "--island-accentHover",
  "--island-accentActive",
  "--island-accentDeep",
  "--island-accentSoft",
] as const;

/** 随主色一起变色的中性令牌（背景/表面/文字/描边/气泡）。 */
type NeutralVar =
  | "--island-bg" | "--island-content" | "--island-panel" | "--island-card" | "--island-canvas"
  | "--island-ink" | "--island-inkSoft" | "--island-muted" | "--island-faint"
  | "--island-border" | "--island-line" | "--island-borderStrong"
  | "--island-user" | "--island-assistant";

/** 浅色主题中性色基准（与 globals.css :root 一致）。 */
const LIGHT_NEUTRALS: Record<NeutralVar, RGB> = {
  "--island-bg": { r: 248, g: 248, b: 240 },
  "--island-content": { r: 247, g: 243, b: 223 },
  "--island-panel": { r: 240, g: 232, b: 216 },
  "--island-card": { r: 255, g: 253, b: 246 },
  "--island-canvas": { r: 248, g: 248, b: 240 },
  "--island-ink": { r: 121, g: 79, b: 39 },
  "--island-inkSoft": { r: 114, g: 93, b: 66 },
  "--island-muted": { r: 159, g: 146, b: 125 },
  "--island-faint": { r: 196, g: 184, b: 158 },
  "--island-border": { r: 232, g: 226, b: 214 },
  "--island-line": { r: 232, g: 226, b: 214 },
  "--island-borderStrong": { r: 170, g: 166, b: 157 },
  "--island-user": { r: 255, g: 238, b: 199 },
  "--island-assistant": { r: 255, g: 253, b: 246 },
};

/** 深色主题中性色基准（与 globals.css .dark 一致）。 */
const DARK_NEUTRALS: Record<NeutralVar, RGB> = {
  "--island-bg": { r: 23, g: 21, b: 15 },
  "--island-content": { r: 28, g: 26, b: 19 },
  "--island-panel": { r: 34, g: 31, b: 23 },
  "--island-card": { r: 38, g: 34, b: 22 },
  "--island-canvas": { r: 23, g: 21, b: 15 },
  "--island-ink": { r: 243, g: 233, b: 214 },
  "--island-inkSoft": { r: 216, g: 204, b: 178 },
  "--island-muted": { r: 168, g: 156, b: 132 },
  "--island-faint": { r: 111, g: 102, b: 83 },
  "--island-border": { r: 55, g: 50, b: 42 },
  "--island-line": { r: 55, g: 50, b: 42 },
  "--island-borderStrong": { r: 92, g: 85, b: 71 },
  "--island-user": { r: 66, g: 58, b: 40 },
  "--island-assistant": { r: 38, g: 34, b: 22 },
};

/** 每个中性令牌向主色混合的比例（越大越接近主色；表面偏小、描边中等、文字最小，保证可读性）。 */
const NEUTRAL_TINT: Record<NeutralVar, number> = {
  "--island-bg": 0.12,
  "--island-content": 0.09,
  "--island-panel": 0.14,
  "--island-card": 0.08,
  "--island-canvas": 0.12,
  "--island-ink": 0.16,
  "--island-inkSoft": 0.14,
  "--island-muted": 0.10,
  "--island-faint": 0.08,
  "--island-border": 0.18,
  "--island-line": 0.18,
  "--island-borderStrong": 0.26,
  "--island-user": 0.12,
  "--island-assistant": 0.08,
};

/** 校验并解析 #rgb / #rrggbb（允许不带 #） */
export function parseHexColor(input: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** 把 hex 字符串（#rrggbb 或 #rgb）规范化为 #rrggbb，非法返回 null */
export function normalizeHex(input: string): string | null {
  const rgb = parseHexColor(input);
  if (!rgb) return null;
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

/** a 向 b 方向混合 t（0~1） */
function mix(a: RGB, b: RGB, t: number): RGB {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return {
    r: clamp(a.r + (b.r - a.r) * t),
    g: clamp(a.g + (b.g - a.g) * t),
    b: clamp(a.b + (b.b - a.b) * t),
  };
}

function toVarString(c: RGB): string {
  return `${c.r} ${c.g} ${c.b}`;
}

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

/** 应用主题：切换 .dark 类 + 覆写主色变量。返回主色是否合法并被写入。 */
export function applyTheme(themeMode: ThemeMode, accentHex: string): boolean {
  const root = document.documentElement;
  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const prefersDark = darkMedia.matches;

  if (themeMode === "system") {
    root.classList.toggle("dark", prefersDark);
    if (!systemListener) {
      systemListener = (e) => root.classList.toggle("dark", e.matches);
      darkMedia.addEventListener("change", systemListener);
    }
  } else {
    root.classList.toggle("dark", themeMode === "dark");
    if (systemListener) {
      darkMedia.removeEventListener("change", systemListener);
      systemListener = null;
    }
  }

  const rgb = parseHexColor(accentHex);
  if (!rgb) return false;

  const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark);
  const hover = mix(rgb, WHITE, 0.18);
  const active = mix(rgb, BLACK, 0.16);
  // 深色下 deep（用于强调文字）需更亮，浅色下更深
  const deep = isDark ? mix(rgb, WHITE, 0.35) : mix(rgb, BLACK, 0.25);
  // soft 底色：浅色 = 白里透主色，深色 = 深褐底透主色
  const soft = isDark ? mix(rgb, DARK_BG, 0.85) : mix(rgb, WHITE, 0.9);

  const set = (name: string, c: RGB) => root.style.setProperty(name, toVarString(c));
  set("--island-accent", rgb);
  set("--island-accentHover", hover);
  set("--island-accentActive", active);
  set("--island-accentDeep", deep);
  set("--island-accentSoft", soft);

  // 中性令牌（背景/表面/文字/描边/气泡）向主色按比例混合，让整页随主色一起变色
  const base = isDark ? DARK_NEUTRALS : LIGHT_NEUTRALS;
  (Object.keys(NEUTRAL_TINT) as NeutralVar[]).forEach((name) => {
    set(name, mix(base[name], rgb, NEUTRAL_TINT[name]));
  });

  return true;
}

/** 移除跟随系统的监听（组件卸载或无需求时可调用） */
export function disposeThemeListener(): void {
  if (systemListener) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .removeEventListener("change", systemListener);
    systemListener = null;
  }
}

export { ACCENT_VARS };