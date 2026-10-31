// A short tap of the phone, e.g. when a dragged item snaps to the centre.
// Android has navigator.vibrate; Safari on iPhone does not, but since iOS 18
// toggling a switch input gives the system's light tap, so a hidden one is
// clicked instead. Elsewhere it does nothing.
let ios: HTMLLabelElement | null = null;

export function haptic() {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
    return;
  }
  if (!ios) {
    ios = document.createElement("label");
    ios.setAttribute("aria-hidden", "true");
    ios.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    ios.appendChild(input);
    document.body.appendChild(ios);
  }
  ios.click();
}
