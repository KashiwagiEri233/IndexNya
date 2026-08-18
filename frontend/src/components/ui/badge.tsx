import * as React from "react";
import { cn } from "@/lib/utils";

export const Badge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    variant?: "default" | "accent" | "success" | "warn" | "error";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variants = {
    default: "bg-island-panel text-island-inkSoft",
    accent: "bg-island-accentSoft text-island-accentDeep",
    success: "bg-island-success/15 text-island-success",
    warn: "bg-island-warn/20 text-[#8a6010]",
    error: "bg-island-error/10 text-island-error",
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
