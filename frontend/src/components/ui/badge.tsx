import * as React from "react";
import { cn } from "@/lib/utils";

export const Badge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    variant?: "default" | "accent" | "success" | "warn";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variants = {
    default: "bg-claude-panel text-claude-muted",
    accent: "bg-claude-accentSoft text-claude-accent",
    success: "bg-emerald-100 text-emerald-700",
    warn: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = "Badge";
