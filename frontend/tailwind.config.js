/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // animal-island-ui 设计令牌（docs/design-system/design-tokens.md）
        island: {
          // 背景：奶油米白 / 羊皮纸内容区 / 次级暖米
          bg: "#f8f8f0",
          content: "#f7f3df",
          panel: "#f0e8d8",
          card: "#fffdf6",
          canvas: "#f8f8f0",
          // 文字：大地棕色系（禁止纯黑）
          ink: "#794f27",
          inkSoft: "#725d42",
          muted: "#9f927d",
          faint: "#c4b89e",
          // 描边
          border: "#e8e2d6",
          line: "#e8e2d6",
          borderStrong: "#aaa69d",
          // 主色：薄荷青绿
          accent: "#19c8b9",
          accentHover: "#3dd4c6",
          accentActive: "#50b9ab",
          accentSoft: "#e6f9f6",
          accentDeep: "#14a094",
          // 状态色
          success: "#6fba2c",
          warn: "#f5c31c",
          error: "#e05a5a",
          focus: "#ffcc00",
          // 聊天气泡
          user: "#ffeec7",
          assistant: "#fffdf6",
          // NookPhone 粉彩应用色板
          pink: "#f8a6b2",
          lavender: "#b77dee",
          sky: "#889df0",
          yellow: "#f7cd67",
          orange: "#e59266",
          seafoam: "#82d5bb",
          sage: "#8ac68a",
          // 兼容旧命名的别名
          mint: "#82d5bb",
          teal: "#19c8b9",
          coral: "#e59266",
          peach: "#f9e3d3",
          butter: "#f7cd67",
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
        "btn-3d-teal": "0 5px 0 0 #14a094",
        "btn-3d-teal-hover": "0 6px 0 0 #14a094",
        "btn-3d-teal-active": "0 1px 0 0 #14a094",
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
