import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // required: icon-only buttons need an accessible name
  icon: ReactNode;
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, pressed, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-md text-text",
        "active:bg-surface-2 disabled:text-text-subtle disabled:opacity-60",
        pressed && "text-accent",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
