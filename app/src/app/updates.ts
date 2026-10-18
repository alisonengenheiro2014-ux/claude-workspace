// New versions of the app. iOS keeps a home-screen app alive in memory, so
// besides the check at start we look again whenever it comes back to the
// front. An update found on the home screen applies at once; inside the
// editor it waits until you go back home, so an edit is never cut short.
import { registerSW } from "virtual:pwa-register";
import { parse } from "./router";

export function watchForUpdates() {
  let ready = false;
  const atHome = () => parse(location.hash).name === "home";
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true;
      if (atHome()) void update(true);
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    },
  });
  window.addEventListener("hashchange", () => {
    if (ready && atHome()) void update(true);
  });
}
