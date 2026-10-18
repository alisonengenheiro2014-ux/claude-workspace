import { forwardRef } from "react";

// Hidden file input. On iPhone it opens the system photo picker. Picking one
// file takes a single tap there; with `multiple` the picker needs its ✓ at the
// top of the screen, out of the thumb's reach. Call .click() straight from a
// tap handler.
export const FilePicker = forwardRef<HTMLInputElement, { onFiles: (files: File[]) => void; accept?: string | null; multiple?: boolean }>(function FilePicker(
  { onFiles, accept = "video/*,image/*", multiple = false },
  ref,
) {
  return (
    <input
      ref={ref}
      type="file"
      accept={accept ?? undefined}
      multiple={multiple}
      hidden
      aria-hidden
      tabIndex={-1}
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
});
