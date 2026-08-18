import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * animal-island-ui 输入规范：pill 形、默认无阴影、暖黄 #ffcc00 焦点。
 * shadow=true 时才加 3D 底影（0 3px 0 0 #d4c9b4）。
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  shadow?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, shadow = false, ...props }, ref) => (
    <input
      ref={ref}
      className={cn("input h-10", shadow && "shadow-input-3d", className)}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-[18px] border-2 border-island-borderStrong/50 bg-white px-4 py-3 text-sm font-medium text-island-ink transition-all duration-200 ease-island placeholder:font-normal placeholder:text-island-muted/70 hover:border-island-borderStrong focus:border-island-accent",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
