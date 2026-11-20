// `delta.mjs themes`: lists plugin themes and installs them into T3's themes folder.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { args, flagValue, readPlugins, repoRoot } from "./core.mjs";

const THEME_ID = /^(?!(?:system|light|dark)$)[a-z0-9](?:[a-z0-9-]{0,47})$/;
// Matches THEME_CSS_MAX_LENGTH in packages/contracts/src/server.ts at the base tag.
const THEME_CSS_MAX_LENGTH = 50_000;

function readThemes() {
  return readPlugins()
    .filter((plugin) => plugin.enabled !== false && plugin.parts?.theme)
    .flatMap((plugin) => {
      const dir = NodePath.join(repoRoot, plugin.parts.theme);
      if (!NodeFS.existsSync(dir)) return [];
      return NodeFS.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const id = NodePath.basename(name, ".json");
          const path = NodePath.join(dir, name);
          const issues = [];
          if (!THEME_ID.test(id)) issues.push(`테마 id 형식이 아님: ${id}`);
          try {
            const theme = JSON.parse(NodeFS.readFileSync(path, "utf8"));
            if (!theme.name || !["light", "dark"].includes(theme.appearance))
              issues.push("name과 appearance(light|dark)가 필요");
            if ((theme.css ?? "").length > THEME_CSS_MAX_LENGTH)
              issues.push(`css가 ${THEME_CSS_MAX_LENGTH}자를 넘음`);
            if (/@import|image-set\(|url\((?!\s*["']?(?:data:|#))/i.test(theme.css ?? ""))
              issues.push("css가 외부 파일을 불러옴");
          } catch (error) {
            issues.push(`JSON 오류: ${error.message}`);
          }
          return { plugin: plugin.id, id, path, issues };
        });
    });
}

export function themes() {
  const home = NodePath.resolve(
    flagValue("--home") ?? process.env.T3CODE_HOME ?? NodePath.join(NodeOS.homedir(), ".t3"),
  );
  const themesDir = NodePath.join(home, "userdata", "themes");
  const list = readThemes();
  if (list.length === 0) return console.log("플러그인 테마가 없다.");
  const install = args.includes("--install");
  let failed = false;
  for (const theme of list) {
    const target = NodePath.join(themesDir, `${theme.id}.json`);
    if (theme.issues.length) {
      failed = true;
      console.log(`✗ ${theme.id} (${theme.plugin}): ${theme.issues.join(", ")}`);
      continue;
    }
    const same =
      NodeFS.existsSync(target) &&
      NodeFS.readFileSync(target, "utf8") === NodeFS.readFileSync(theme.path, "utf8");
    if (install && !same) {
      NodeFS.mkdirSync(themesDir, { recursive: true });
      NodeFS.copyFileSync(theme.path, target);
    }
    const state = same
      ? "설치됨(최신)"
      : install
        ? "설치함"
        : NodeFS.existsSync(target)
          ? "설치됨(다름)"
          : "설치 안 됨";
    console.log(`${theme.id} (${theme.plugin}) → ${target}  ${state}`);
  }
  if (install)
    console.log(
      "\nT3 Code의 Settings → Appearance에서 테마를 고른다. 파일을 바꾸면 바로 반영된다.",
    );
  if (failed) process.exit(1);
}
