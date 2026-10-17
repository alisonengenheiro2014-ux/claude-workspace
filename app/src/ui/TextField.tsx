import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }>(
  function TextField({ label, error, className, ...rest }, ref) {
    const id = useId();
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-xs text-text-muted">
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={cn(
            "h-11 rounded-md border border-border-input bg-surface-2 px-3 text-base text-text",
            "placeholder:text-text-subtle aria-[invalid]:border-danger",
            className,
          )}
          {...rest}
        />
        {error && (
          <p id={`${id}-err`} className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
