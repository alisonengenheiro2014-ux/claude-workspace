import * as RTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export function Tabs({
  value,
  onValueChange,
  tabs,
  label,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: string; content: ReactNode }[];
  label: string;
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List aria-label={label} className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="h-11 shrink-0 border-b-2 border-transparent px-3 text-sm text-text-muted data-[state=active]:border-accent data-[state=active]:text-text"
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="pt-4 outline-none">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
