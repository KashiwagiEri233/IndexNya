/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Animal Island UI inspired palette: soft teal, coral, peach and lavender.
        claude: {
          bg: "#fbfaf7",
          panel: "#f2f8f6",
          border: "#e4ebe7",
          ink: "#30404a",
          muted: "#7f8c91",
          accent: "#68aaa7",
          accentHover: "#4e9592",
          accentSoft: "#e0f2ef",
          user: "#fff0e8",
          assistant: "#ffffff",
        },
        island: {
          mint: "#b2dfdb",
          teal: "#68aaa7",
          coral: "#f3a6a7",
          peach: "#fae3d9",
          sky: "#8ac6d1",
          lavender: "#c3b1e1",
          butter: "#f6d98b",
          ink: "#30404a",
          muted: "#7f8c91",
          canvas: "#fbfaf7",
          line: "#e4ebe7",
        },
      },
      fontFamily: {
        sans: [
          "Nunito",
          "ui-rounded",
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
      borderRadius: {
        island: "1.25rem",
        bubble: "1.5rem",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(91, 113, 112, 0.08), 0 2px 8px rgba(91, 113, 112, 0.05)",
        island: "0 14px 32px rgba(91, 113, 112, 0.10), 0 3px 10px rgba(91, 113, 112, 0.06)",
        "island-hover": "0 16px 36px rgba(91, 113, 112, 0.16), 0 5px 12px rgba(91, 113, 112, 0.08)",
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
        "fade-in": "fade-in 0.25s ease-out",
        "float-in": "float-in 0.42s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
