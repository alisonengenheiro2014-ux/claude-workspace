// Pure helpers for user-customized toolbars. Stored only on the device.
export function orderedToolIds(ids: string[], saved: string[]) {
  const positions = new Map(saved.map((key, i) => [key, i]));
  return ids.map((id, i) => ({ id, i }))
    .sort((a, b) => {
      const pa = positions.get(a.id);
      const pb = positions.get(b.id);
      if (pa === undefined && pb === undefined) return a.i - b.i;
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    }).map((i) => i.id);
}

export function moveTool(ids: string[], moved: string, target: string) {
  const from = ids.indexOf(moved);
  const to = ids.indexOf(target);
  if (from === -1 || to === -1 || from === to) return ids;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function loadToolbarOrder(label: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("garage:toolbar:v1:" + label) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
  } catch { return []; }
}
export function saveToolbarOrder(label: string, order: string[]) {
  try { localStorage.setItem("garage:toolbar:v1:" + label, JSON.stringify(order)); } catch { /* storage may be full */ }
}
