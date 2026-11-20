#!/usr/bin/env node
// Builds theme/delta.json: the stock T3 Code palette (light, with the dark variant) from the
// upstream source this fork is on, plus theme.css. Re-run after an upstream update so the theme
// keeps the stock colors upstream ships. Usage: node delta/plugins/sidebar-style/build.mjs
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repoRoot = NodePath.resolve(here, "../../..");
const palettes = NodeFS.readFileSync(
  NodePath.join(repoRoot, "packages/shared/src/themePalettes.ts"),
  "utf8",
);

/** Reads `export const NAME: ThemeColors = { key: "value", ... };` without running TypeScript. */
function readPalette(name) {
  const block = palettes.match(
    new RegExp(`export const ${name}: ThemeColors = \\{([\\s\\S]*?)\\n\\};`),
  );
  if (!block) throw new Error(`${name} not found in packages/shared/src/themePalettes.ts`);
  const colors = {};
  for (const [, key, value] of block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*): "([^"]+)",?$/gm)) {
    colors[key] = value;
  }
  if (Object.keys(colors).length < 20) throw new Error(`${name}: could not read its colors`);
  return colors;
}

const theme = {
  version: 1,
  name: "Delta",
  appearance: "light",
  colors: readPalette("T3_CODE_LIGHT_THEME_COLORS"),
  variants: { dark: readPalette("T3_CODE_DARK_THEME_COLORS") },
  css: NodeFS.readFileSync(NodePath.join(here, "theme.css"), "utf8"),
};
NodeFS.writeFileSync(
  NodePath.join(here, "theme/delta.json"),
  `${JSON.stringify(theme, null, 2)}\n`,
);
console.log(
  `theme/delta.json: ${Object.keys(theme.colors).length} light and ${Object.keys(theme.variants.dark).length} dark colors, css ${theme.css.length} chars`,
);
