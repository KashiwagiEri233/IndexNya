import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "outline" | "soft";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    const variants = {
      primary: "bg-claude-accent text-white shadow-soft hover:-translate-y-0.5 hover:bg-claude-accentHover hover:shadow-island",
      ghost: "text-claude-ink hover:bg-white hover:text-claude-accent hover:shadow-soft",
      outline: "border bg-white text-claude-ink shadow-soft hover:-translate-y-0.5 hover:border-claude-accent/40 hover:bg-claude-accentSoft/60",
      soft: "bg-claude-accentSoft text-claude-accent hover:bg-claude-accent/20",
    };
    const sizes = {
      sm: "h-9 px-3.5 text-xs",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
      icon: "h-10 w-10",
    };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-full font-bold transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
