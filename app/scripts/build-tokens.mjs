// Generates CSS from replica/design/tokens.json, the single source of truth.
//   replica/design/tokens.css   plain custom properties (any stack)
//   app/src/styles/theme.css    the same values as a Tailwind v4 @theme
// Tailwind's default palette, type, radius and shadow scales are reset so
// components can only use token utilities (bg-surface, text-text-muted...).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(here, "../../replica/design/tokens.json");
const t = JSON.parse(readFileSync(tokensPath, "utf8"));

const vars = [];
for (const [k, v] of Object.entries(t.color)) vars.push([`--color-${k}`, v]);
vars.push(["--font-sans", t.font.sans], ["--font-mono", t.font.mono]);
for (const [k, v] of Object.entries(t.type)) {
  vars.push([`--text-${k}`, `${v.size}px`]);
  vars.push([`--text-${k}--line-height`, `${v.line}px`]);
  vars.push([`--text-${k}--font-weight`, String(v.weight)]);
}
for (const [k, v] of Object.entries(t.radius)) vars.push([`--radius-${k}`, `${v}px`]);
for (const [k, v] of Object.entries(t.shadow)) vars.push([`--shadow-${k}`, v]);
for (const [k, v] of Object.entries(t.motion)) vars.push([`--motion-${k}`, v]);
for (const [k, v] of Object.entries(t.layout)) {
  if (typeof v === "number") vars.push([`--layout-${k}`, `${v}px`]);
  else if (/^\d+(vh|vw|%)$/.test(v)) vars.push([`--layout-${k}`, v]);
}

const body = vars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
const header = "/* Generated from replica/design/tokens.json by app/scripts/build-tokens.mjs. Do not edit. */\n";

writeFileSync(resolve(here, "../../replica/design/tokens.css"), `${header}:root {\n${body}\n}\n`);
writeFileSync(
  resolve(here, "../src/styles/theme.css"),
  `${header}@theme {\n  --color-*: initial;\n  --text-*: initial;\n  --radius-*: initial;\n  --shadow-*: initial;\n  --spacing: 4px;\n${body}\n}\n`,
);
console.log(`tokens: ${vars.length} variables written`);
