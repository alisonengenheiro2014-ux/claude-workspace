import { forwardRef } from "react";

// Hidden file input. On iPhone it opens the system photo picker with
// multi-select. Call .click() straight from a tap handler.
export const FilePicker = forwardRef<HTMLInputElement, { onFiles: (files: File[]) => void }>(function FilePicker(
  { onFiles },
  ref,
) {
  return (
    <input
      ref={ref}
      type="file"
      accept="video/*,image/*"
      multiple
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
