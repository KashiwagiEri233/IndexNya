import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * animal-island-ui Title —— 燕尾飘带（swallowtail ribbon）。
 * 结构还原组件库 Title：左右燕尾（clip-path）+ 折角三角阴影 + 3deg 透视正面。
 * 颜色通过 --rf（正面）/ --rb（燕尾）/ --rk（折角）/ --rt（文字）四个变量控制。
 */
const RIBBON_COLORS = {
  teal: { rf: "rgb(var(--island-accent))", rb: "rgb(var(--island-accentActive))", rk: "rgb(var(--island-accentDeep))", rt: "#ffffff" },
  default: { rf: "rgb(var(--island-accent))", rb: "rgb(var(--island-accentActive))", rk: "rgb(var(--island-accentDeep))", rt: "#ffffff" },
  "app-pink": { rf: "#f8a6b2", rb: "#e06880", rk: "#a03060", rt: "#ffffff" },
  pink: { rf: "#f8a6b2", rb: "#e06880", rk: "#a03060", rt: "#ffffff" },
  purple: { rf: "#b77dee", rb: "#9050d0", rk: "#5a1a9a", rt: "#ffffff" },
  "app-blue": { rf: "#889df0", rb: "#5068d8", rk: "#2030a0", rt: "#ffffff" },
  blue: { rf: "#889df0", rb: "#5068d8", rk: "#2030a0", rt: "#ffffff" },
  "app-yellow": { rf: "#f7cd67", rb: "#d4a030", rk: "#8a6010", rt: "#725d42" },
  yellow: { rf: "#f7cd67", rb: "#d4a030", rk: "#8a6010", rt: "#725d42" },
  "app-orange": { rf: "#e59266", rb: "#c06a30", rk: "#7a3a10", rt: "#ffffff" },
  orange: { rf: "#e59266", rb: "#c06a30", rk: "#7a3a10", rt: "#ffffff" },
  "app-teal": { rf: "#82d5bb", rb: "#40a880", rk: "#186048", rt: "#ffffff" },
  "app-green": { rf: "#8ac68a", rb: "#509050", rk: "#205020", rt: "#ffffff" },
  green: { rf: "#8ac68a", rb: "#509050", rk: "#205020", rt: "#ffffff" },
  "app-red": { rf: "#fc736d", rb: "#d43030", rk: "#900010", rt: "#ffffff" },
  red: { rf: "#fc736d", rb: "#d43030", rk: "#900010", rt: "#ffffff" },
  "lime-green": { rf: "#d1da49", rb: "#90a010", rk: "#485800", rt: "#3d5a1a" },
  lime: { rf: "#d1da49", rb: "#90a010", rk: "#485800", rt: "#3d5a1a" },
  "yellow-green": { rf: "#ecdf52", rb: "#c0b010", rk: "#706800", rt: "#725d42" },
  yellowGreen: { rf: "#ecdf52", rb: "#c0b010", rk: "#706800", rt: "#725d42" },
  brown: { rf: "#9a835a", rb: "#705830", rk: "#3a2810", rt: "#ffffff" },
  "warm-peach-pink": { rf: "#e18c6f", rb: "#b85a30", rk: "#6a2a10", rt: "#ffffff" },
  peach: { rf: "#e18c6f", rb: "#b85a30", rk: "#6a2a10", rt: "#ffffff" },
  leaf: { rf: "#27d039", rb: "#20992a", rk: "#115017", rt: "#ffffff" },
} as const;

export type RibbonColor = keyof typeof RIBBON_COLORS;

export function RibbonTitle({
  color = "teal",
  icon,
  children,
  className,
}: {
  color?: RibbonColor;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const c = RIBBON_COLORS[color];
  return (
    <span
      className={cn("ribbon", className)}
      style={{ "--rf": c.rf, "--rb": c.rb, "--rk": c.rk, "--rt": c.rt } as React.CSSProperties}
    >
      <span className="ribbon-back ribbon-back-left" aria-hidden="true" />
      <span className="ribbon-back ribbon-back-right" aria-hidden="true" />
      <span className="ribbon-fold ribbon-fold-left" aria-hidden="true" />
      <span className="ribbon-fold ribbon-fold-right" aria-hidden="true" />
      <span className="ribbon-front" aria-hidden="true" />
      <span className="ribbon-text">
        {icon}
        {children}
      </span>
    </span>
  );
}
