import * as React from "react";
import { cn } from "@/lib/utils";

export type CardColor =
  | "default"
  | "app-pink"
  | "purple"
  | "app-blue"
  | "app-yellow"
  | "app-orange"
  | "app-teal"
  | "app-green"
  | "app-red"
  | "lime-green"
  | "yellow-green"
  | "brown"
  | "warm-peach-pink";

export type CardPattern = "none" | CardColor;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  color?: CardColor;
  pattern?: CardPattern;
  hoverable?: boolean;
  dashed?: boolean;
}

/** animal-island-ui 规范卡片：20px 圆角、无浮动投影、支持 13 色纯色与双层波点墙纸。 */
export const Card = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, color = "default", pattern = "none", hoverable = false, dashed = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "card",
      dashed && "card-dashed",
      hoverable && "card-hoverable",
      color !== "default" && `card-${color}`,
      pattern !== "none" && `pattern-${pattern}`,
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1 border-b border-island-border/80 p-5", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-base font-extrabold leading-none text-island-ink", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5", className)} {...props} />
));
CardContent.displayName = "CardContent";
