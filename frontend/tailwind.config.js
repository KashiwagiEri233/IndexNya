/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // animal-island-ui 设计令牌 —— 值以 CSS 变量承载（:root 浅色 / .dark 深色），
        // 主色 accent 一族可由用户在设置中自定义并写入 --island-accent*。
        island: {
          // 背景：奶油米白 / 羊皮纸内容区 / 次级暖米
          bg: "rgb(var(--island-bg) / <alpha-value>)",
          content: "rgb(var(--island-content) / <alpha-value>)",
          panel: "rgb(var(--island-panel) / <alpha-value>)",
          card: "rgb(var(--island-card) / <alpha-value>)",
          canvas: "rgb(var(--island-canvas) / <alpha-value>)",
          // 文字：大地棕色系（禁止纯黑）
          ink: "rgb(var(--island-ink) / <alpha-value>)",
          inkSoft: "rgb(var(--island-inkSoft) / <alpha-value>)",
          muted: "rgb(var(--island-muted) / <alpha-value>)",
          faint: "rgb(var(--island-faint) / <alpha-value>)",
          // 描边
          border: "rgb(var(--island-border) / <alpha-value>)",
          line: "rgb(var(--island-line) / <alpha-value>)",
          borderStrong: "rgb(var(--island-borderStrong) / <alpha-value>)",
          // 主色：薄荷青绿（用户可自定义 → 运行时写入 --island-accent*）
          accent: "rgb(var(--island-accent) / <alpha-value>)",
          accentHover: "rgb(var(--island-accentHover) / <alpha-value>)",
          accentActive: "rgb(var(--island-accentActive) / <alpha-value>)",
          accentSoft: "rgb(var(--island-accentSoft) / <alpha-value>)",
          accentDeep: "rgb(var(--island-accentDeep) / <alpha-value>)",
          // 状态色
          success: "rgb(var(--island-success) / <alpha-value>)",
          warn: "rgb(var(--island-warn) / <alpha-value>)",
          error: "rgb(var(--island-error) / <alpha-value>)",
          focus: "rgb(var(--island-focus) / <alpha-value>)",
          // 聊天气泡
          user: "rgb(var(--island-user) / <alpha-value>)",
          assistant: "rgb(var(--island-assistant) / <alpha-value>)",
          // NookPhone 粉彩应用色板（深色模式下降饱和变亮）
          pink: "rgb(var(--island-pink) / <alpha-value>)",
          lavender: "rgb(var(--island-lavender) / <alpha-value>)",
          sky: "rgb(var(--island-sky) / <alpha-value>)",
          yellow: "rgb(var(--island-yellow) / <alpha-value>)",
          orange: "rgb(var(--island-orange) / <alpha-value>)",
          seafoam: "rgb(var(--island-seafoam) / <alpha-value>)",
          sage: "rgb(var(--island-sage) / <alpha-value>)",
          // 兼容旧命名的别名
          mint: "rgb(var(--island-seafoam) / <alpha-value>)",
          teal: "rgb(var(--island-accent) / <alpha-value>)",
          coral: "rgb(var(--island-orange) / <alpha-value>)",
          peach: "rgb(var(--island-peach) / <alpha-value>)",
          butter: "rgb(var(--island-yellow) / <alpha-value>)",
          // 深色下可读的辅助文字色（导航色砖 / 探索分类徽标等）
          skyDeep: "rgb(var(--island-skyDeep) / <alpha-value>)",
          lavenderDeep: "rgb(var(--island-lavenderDeep) / <alpha-value>)",
          orangeDeep: "rgb(var(--island-orangeDeep) / <alpha-value>)",
          seafoamDeep: "rgb(var(--island-seafoamDeep) / <alpha-value>)",
          yellowDeep: "rgb(var(--island-yellowDeep) / <alpha-value>)",
          // 代码块与开关等辅助色
          codeBg: "rgb(var(--island-codeBg) / <alpha-value>)",
          codeInk: "rgb(var(--island-codeInk) / <alpha-value>)",
          successDeep: "rgb(var(--island-successDeep) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "Nunito",
          "Noto Sans SC",
          "ui-rounded",
          "-apple-system",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      borderRadius: {
        island: "20px",
        bubble: "24px",
      },
      boxShadow: {
        // 规范三档柔和高程阴影（暖棕基色）
        soft: "0 2px 4px 0 rgba(61, 52, 40, 0.06)",
        island: "0 3px 10px 0 rgba(61, 52, 40, 0.1)",
        "island-hover": "0 8px 24px 0 rgba(61, 52, 40, 0.14)",
        // 3D 像素堆叠阴影 —— 仅 primary 级按钮
        "btn-3d": "0 5px 0 0 #bdaea0",
        "btn-3d-hover": "0 6px 0 0 #bdaea0",
        "btn-3d-active": "0 1px 0 0 #bdaea0",
        "btn-3d-teal": "0 5px 0 0 var(--island-accentDeep)",
        "btn-3d-teal-hover": "0 6px 0 0 var(--island-accentDeep)",
        "btn-3d-teal-active": "0 1px 0 0 var(--island-accentDeep)",
        "input-3d": "0 3px 0 0 #d4c9b4",
      },
      transitionTimingFunction: {
        island: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "float-in": {
          from: { opacity: "0", transform: "translateY(10px) scale(.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        "float-in": "float-in 0.35s cubic-bezier(0.4, 0, 0.2, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
