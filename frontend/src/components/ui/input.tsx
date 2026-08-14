import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl border bg-white px-4 py-2.5 text-sm outline-none transition-shadow placeholder:text-claude-muted/70 focus:ring-4 focus:ring-claude-accent/20",
        className
      )}
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
      "w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none transition-shadow placeholder:text-claude-muted/70 focus:ring-4 focus:ring-claude-accent/20 resize-none",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
