/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Claude 网页端配色 token
        claude: {
          bg: "#faf9f5",          // 暖白底
          panel: "#f0eee6",        // 侧栏底
          border: "#e5e2d9",       // 分割线
          ink: "#1f1e1d",          // 深棕主文
          muted: "#87867f",        // 次级文字
          accent: "#d97757",       // 橙色强调（Claude 主色）
          accentHover: "#c2684a",
          accentSoft: "#f7ede3",  // 强调浅底
          user: "#f7ede3",         // 用户气泡
          assistant: "#ffffff",   // assistant 气泡
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        serif: ["Georgia", "Noto Serif SC", "serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
