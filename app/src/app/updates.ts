// New versions of the app. iOS keeps a home-screen app alive in memory, so
// besides the check at start we look again whenever it comes back to the
// front. An update applies by itself only on the home screen and only when
// nothing is under way; otherwise the home screen offers it with a button.
// (Opening the photo picker sends the page to the back: an update found as it
// returns used to reload the page and lose the files just picked.)
import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { importsInProgress } from "../media/import";
import { parse } from "./router";

let ready = false;
let apply: () => void = () => {};
const listeners = new Set<() => void>();

export function useUpdateReady() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ready,
  );
}

export function applyUpdate() {
  apply();
}

export function watchForUpdates() {
  let pickedAt = -Infinity;
  // a file picker opening (a click on a file input, also from code)
  document.addEventListener(
    "click",
    (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "file") pickedAt = performance.now();
    },
    true,
  );
  const atHome = () => parse(location.hash).name === "home";
  const safe = () => atHome() && performance.now() - pickedAt > 60_000 && !importsInProgress();
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true;
      listeners.forEach((l) => l());
      if (safe()) void update(true);
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    },
  });
  apply = () => void update(true);
  window.addEventListener("hashchange", () => {
    if (ready && safe()) void update(true);
  });
}
