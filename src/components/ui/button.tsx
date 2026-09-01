import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * animal-island-ui 按钮规范：
 * - pill 形（rounded-full），字重 600+
 * - 3D 像素堆叠阴影仅用于 primary 级（primary / accent）
 * - default / soft / ghost 只用柔和高程阴影
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "accent" | "default" | "soft" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    const variants = {
      primary: "btn-primary",
      accent: "btn-accent",
      default: "btn-default",
      soft: "btn bg-island-accentSoft text-island-accentDeep shadow-none hover:bg-island-accent/20",
      ghost: "btn-ghost",
    };
    const sizes = {
      sm: "h-9 px-4 text-xs",
      md: "h-10 px-5 text-sm",
      lg: "h-12 px-7 text-base",
      icon: "h-10 w-10 px-0",
    };
    return (
      <button
        ref={ref}
        className={cn(variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
