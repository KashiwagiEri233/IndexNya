import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "accent" | "success" | "warn" | "error" | "solid" | "outlined" | "dashed" | "soft";

export type BadgeColor =
  | "default"
  | "accent"
  | "success"
  | "warn"
  | "error"
  | "app-pink"
  | "pink"
  | "purple"
  | "app-blue"
  | "blue"
  | "app-yellow"
  | "yellow"
  | "app-orange"
  | "orange"
  | "app-teal"
  | "teal"
  | "app-green"
  | "green"
  | "app-red"
  | "red"
  | "lime-green"
  | "lime"
  | "yellow-green"
  | "brown"
  | "warm-peach-pink"
  | "peach";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  color?: BadgeColor;
}

const COLOR_MAP: Record<BadgeColor, { solid: string; soft: string; outlined: string; dashed: string }> = {
  default: {
    solid: "bg-island-panel text-island-ink border-island-borderStrong/60",
    soft: "bg-island-panel text-island-inkSoft border-transparent",
    outlined: "bg-transparent text-island-inkSoft border-island-borderStrong",
    dashed: "bg-transparent text-island-inkSoft border-island-borderStrong border-dashed",
  },
  accent: {
    solid: "bg-island-accent text-white border-island-accent",
    soft: "bg-island-accentSoft text-island-accentDeep border-transparent",
    outlined: "bg-transparent text-island-accentDeep border-island-accent",
    dashed: "bg-transparent text-island-accentDeep border-island-accent border-dashed",
  },
  success: {
    solid: "bg-island-success text-white border-island-success",
    soft: "bg-island-success/15 text-island-success border-transparent",
    outlined: "bg-transparent text-island-success border-island-success",
    dashed: "bg-transparent text-island-success border-island-success border-dashed",
  },
  warn: {
    solid: "bg-island-warn text-island-ink border-island-warn",
    soft: "bg-island-warn/20 text-island-yellowDeep border-transparent",
    outlined: "bg-transparent text-island-yellowDeep border-island-warn",
    dashed: "bg-transparent text-island-yellowDeep border-island-warn border-dashed",
  },
  error: {
    solid: "bg-island-error text-white border-island-error",
    soft: "bg-island-error/10 text-island-error border-transparent",
    outlined: "bg-transparent text-island-error border-island-error",
    dashed: "bg-transparent text-island-error border-island-error border-dashed",
  },
  "app-pink": {
    solid: "bg-[#f8a6b2] text-white border-[#f8a6b2]",
    soft: "bg-[#fce4ec] text-[#c2185b] border-transparent",
    outlined: "bg-transparent text-[#f8a6b2] border-[#f8a6b2]",
    dashed: "bg-transparent text-[#f8a6b2] border-[#f8a6b2] border-dashed",
  },
  pink: {
    solid: "bg-[#f8a6b2] text-white border-[#f8a6b2]",
    soft: "bg-[#fce4ec] text-[#c2185b] border-transparent",
    outlined: "bg-transparent text-[#f8a6b2] border-[#f8a6b2]",
    dashed: "bg-transparent text-[#f8a6b2] border-[#f8a6b2] border-dashed",
  },
  purple: {
    solid: "bg-[#b77dee] text-white border-[#b77dee]",
    soft: "bg-[#f3e5f5] text-[#7b1fa2] border-transparent",
    outlined: "bg-transparent text-[#b77dee] border-[#b77dee]",
    dashed: "bg-transparent text-[#b77dee] border-[#b77dee] border-dashed",
  },
  "app-blue": {
    solid: "bg-[#889df0] text-white border-[#889df0]",
    soft: "bg-[#e6f0ff] text-[#1565c0] border-transparent",
    outlined: "bg-transparent text-[#889df0] border-[#889df0]",
    dashed: "bg-transparent text-[#889df0] border-[#889df0] border-dashed",
  },
  blue: {
    solid: "bg-[#889df0] text-white border-[#889df0]",
    soft: "bg-[#e6f0ff] text-[#1565c0] border-transparent",
    outlined: "bg-transparent text-[#889df0] border-[#889df0]",
    dashed: "bg-transparent text-[#889df0] border-[#889df0] border-dashed",
  },
  "app-yellow": {
    solid: "bg-[#f7cd67] text-[#725d42] border-[#f7cd67]",
    soft: "bg-[#fff8e1] text-[#f9a825] border-transparent",
    outlined: "bg-transparent text-[#f7cd67] border-[#f7cd67]",
    dashed: "bg-transparent text-[#f7cd67] border-[#f7cd67] border-dashed",
  },
  yellow: {
    solid: "bg-[#f7cd67] text-[#725d42] border-[#f7cd67]",
    soft: "bg-[#fff8e1] text-[#f9a825] border-transparent",
    outlined: "bg-transparent text-[#f7cd67] border-[#f7cd67]",
    dashed: "bg-transparent text-[#f7cd67] border-[#f7cd67] border-dashed",
  },
  "app-orange": {
    solid: "bg-[#e59266] text-white border-[#e59266]",
    soft: "bg-[#fff3e0] text-[#e65100] border-transparent",
    outlined: "bg-transparent text-[#e59266] border-[#e59266]",
    dashed: "bg-transparent text-[#e59266] border-[#e59266] border-dashed",
  },
  orange: {
    solid: "bg-[#e59266] text-white border-[#e59266]",
    soft: "bg-[#fff3e0] text-[#e65100] border-transparent",
    outlined: "bg-transparent text-[#e59266] border-[#e59266]",
    dashed: "bg-transparent text-[#e59266] border-[#e59266] border-dashed",
  },
  "app-teal": {
    solid: "bg-[#82d5bb] text-white border-[#82d5bb]",
    soft: "bg-[#e0f2f1] text-[#00695c] border-transparent",
    outlined: "bg-transparent text-[#82d5bb] border-[#82d5bb]",
    dashed: "bg-transparent text-[#82d5bb] border-[#82d5bb] border-dashed",
  },
  teal: {
    solid: "bg-island-accent text-white border-island-accent",
    soft: "bg-island-accentSoft text-island-accentDeep border-transparent",
    outlined: "bg-transparent text-island-accentDeep border-island-accent",
    dashed: "bg-transparent text-island-accentDeep border-island-accent border-dashed",
  },
  "app-green": {
    solid: "bg-[#8ac68a] text-white border-[#8ac68a]",
    soft: "bg-[#e8f5e9] text-[#2e7d32] border-transparent",
    outlined: "bg-transparent text-[#8ac68a] border-[#8ac68a]",
    dashed: "bg-transparent text-[#8ac68a] border-[#8ac68a] border-dashed",
  },
  green: {
    solid: "bg-[#8ac68a] text-white border-[#8ac68a]",
    soft: "bg-[#e8f5e9] text-[#2e7d32] border-transparent",
    outlined: "bg-transparent text-[#8ac68a] border-[#8ac68a]",
    dashed: "bg-transparent text-[#8ac68a] border-[#8ac68a] border-dashed",
  },
  "app-red": {
    solid: "bg-[#fc736d] text-white border-[#fc736d]",
    soft: "bg-[#ffebee] text-[#c62828] border-transparent",
    outlined: "bg-transparent text-[#fc736d] border-[#fc736d]",
    dashed: "bg-transparent text-[#fc736d] border-[#fc736d] border-dashed",
  },
  red: {
    solid: "bg-[#fc736d] text-white border-[#fc736d]",
    soft: "bg-[#ffebee] text-[#c62828] border-transparent",
    outlined: "bg-transparent text-[#fc736d] border-[#fc736d]",
    dashed: "bg-transparent text-[#fc736d] border-[#fc736d] border-dashed",
  },
  "lime-green": {
    solid: "bg-[#d1da49] text-white border-[#d1da49]",
    soft: "bg-[#f1f8e9] text-[#558b2f] border-transparent",
    outlined: "bg-transparent text-[#d1da49] border-[#d1da49]",
    dashed: "bg-transparent text-[#d1da49] border-[#d1da49] border-dashed",
  },
  lime: {
    solid: "bg-[#d1da49] text-white border-[#d1da49]",
    soft: "bg-[#f1f8e9] text-[#558b2f] border-transparent",
    outlined: "bg-transparent text-[#d1da49] border-[#d1da49]",
    dashed: "bg-transparent text-[#d1da49] border-[#d1da49] border-dashed",
  },
  "yellow-green": {
    solid: "bg-[#ecdf52] text-[#725d42] border-[#ecdf52]",
    soft: "bg-[#f9fbe7] text-[#827717] border-transparent",
    outlined: "bg-transparent text-[#ecdf52] border-[#ecdf52]",
    dashed: "bg-transparent text-[#ecdf52] border-[#ecdf52] border-dashed",
  },
  brown: {
    solid: "bg-[#9a835a] text-white border-[#9a835a]",
    soft: "bg-[#efebe9] text-[#4e342e] border-transparent",
    outlined: "bg-transparent text-[#9a835a] border-[#9a835a]",
    dashed: "bg-transparent text-[#9a835a] border-[#9a835a] border-dashed",
  },
  "warm-peach-pink": {
    solid: "bg-[#e18c6f] text-white border-[#e18c6f]",
    soft: "bg-[#fbe9e7] text-[#bf360c] border-transparent",
    outlined: "bg-transparent text-[#e18c6f] border-[#e18c6f]",
    dashed: "bg-transparent text-[#e18c6f] border-[#e18c6f] border-dashed",
  },
  peach: {
    solid: "bg-[#e18c6f] text-white border-[#e18c6f]",
    soft: "bg-[#fbe9e7] text-[#bf360c] border-transparent",
    outlined: "bg-transparent text-[#e18c6f] border-[#e18c6f]",
    dashed: "bg-transparent text-[#e18c6f] border-[#e18c6f] border-dashed",
  },
};

export const Badge = React.forwardRef<
  HTMLSpanElement,
  BadgeProps
>(({ className, variant = "default", color, ...props }, ref) => {
  // 兼容旧用法：variant 传 "accent" | "success" | "warn" | "error" 时直接映射
  let styleCls = "";
  const targetColor: BadgeColor = color ?? (variant === "solid" || variant === "outlined" || variant === "dashed" || variant === "soft" ? "default" : (variant as BadgeColor));
  const targetVariant = variant === "solid" || variant === "outlined" || variant === "dashed" || variant === "soft" ? variant : "soft";

  const palette = COLOR_MAP[targetColor] ?? COLOR_MAP.default;
  styleCls = palette[targetVariant];

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide transition-colors",
        styleCls,
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = "Badge";
