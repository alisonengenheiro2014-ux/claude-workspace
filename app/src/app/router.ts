import { useEffect, useState } from "react";

// Hash routes, so the PWA works from any static host and offline.
//   #/            S01 início
//   #/p/:id       S03 editor (S04–S17 open inside it as sheets)
//   #/design      design system page
export type Route = { name: "home" } | { name: "editor"; projectId: string } | { name: "design" };

export function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const m = path.match(/^\/p\/([\w-]+)$/);
  if (m) return { name: "editor", projectId: m[1] };
  if (path === "/design") return { name: "design" };
  return { name: "home" };
}

export function navigate(path: string, replace = false) {
  if (replace) location.replace(`#${path}`);
  else location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
