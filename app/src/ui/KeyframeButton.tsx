import { Diamond } from "lucide-react";
import { IconButton } from "./IconButton";

// Adds or removes a keyframe at the playhead. Filled when one exists there.
export function KeyframeButton({ active, disabled, onToggle }: { active: boolean; disabled?: boolean; onToggle?: () => void }) {
  return (
    <IconButton
      label={active ? "Remover keyframe" : "Adicionar keyframe"}
      pressed={active}
      disabled={disabled}
      onClick={onToggle}
      icon={<Diamond className="size-5" fill={active ? "currentColor" : "none"} />}
    />
  );
}
