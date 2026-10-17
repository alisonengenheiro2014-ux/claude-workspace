import * as RSlider from "@radix-ui/react-slider";
import { useId } from "react";

// Labelled slider. Double-tap the thumb to go back to the default value.
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  defaultValue,
  format = (v) => String(v),
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  const defaultPct = defaultValue === undefined ? null : ((defaultValue - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <label id={id} className="text-text-muted">
          {label}
        </label>
        <span className="font-mono text-text tabular-nums">{format(value)}</span>
      </div>
      <RSlider.Root
        aria-labelledby={id}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="relative flex h-11 touch-none select-none items-center data-[disabled]:opacity-40"
      >
        <RSlider.Track className="relative h-1 grow rounded-pill bg-surface-3">
          <RSlider.Range className="absolute h-full rounded-pill bg-accent" />
          {defaultPct !== null && (
            <span
              aria-hidden
              className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-text-subtle"
              style={{ left: `${defaultPct}%` }}
            />
          )}
        </RSlider.Track>
        <RSlider.Thumb
          aria-label={label}
          aria-valuetext={format(value)}
          onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
          className="block size-6 rounded-pill bg-text shadow-pop"
        />
      </RSlider.Root>
    </div>
  );
}
