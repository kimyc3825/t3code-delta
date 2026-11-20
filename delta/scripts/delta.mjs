#!/usr/bin/env node
// T3 Code - Delta fork helper. Shows which upstream T3 Code release this fork is built on,
// whether upstream has a newer stable release, and whether the fork's upstream edits (seams),
// pending upstream patches, commit stack and plugins (delta/plugins/*/plugin.json) are in the
// state delta/delta.json describes.
//
// Usage: node delta/scripts/delta.mjs [status|version|check] [--json] [--offline]
//   status   (default) human-readable report
//   version  prints the build version for APP_VERSION, e.g. 0.1.10+delta.1
//   check    exits 1 when the fork breaks its own rules (for rebases and CI)
// No dependencies: needs only Node, git, and optionally gh for pull request states.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "delta/delta.json"), "utf8"));
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--")) ?? "status";
const asJson = args.includes("--json");
const offline = args.includes("--offline");

/** Runs a command in the repo root. Returns trimmed stdout, or null when it fails. */
function run(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
const git = (...gitArgs) => run("git", gitArgs);

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
function compareStableTags(left, right) {
  const a = left.match(STABLE_TAG).slice(1).map(Number);
  const b = right.match(STABLE_TAG).slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function buildVersion() {
  const upstreamVersion = manifest.upstream.tag.replace(/^v/, "");
  return `${upstreamVersion}+${manifest.codename.toLowerCase()}.${manifest.revision}`;
}

function readBase() {
  const { tag, commit } = manifest.upstream;
  const tagCommit = git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
  return {
    tag,
    commit,
    tagMatchesCommit: tagCommit === null ? null : tagCommit === commit,
    inHead: git("merge-base", "--is-ancestor", commit, "HEAD") !== null,
  };
}

function readLatestUpstream() {
  if (offline) return null;
  const output = git("ls-remote", "--tags", "--refs", "upstream", "v*");
  if (output === null) return null;
  const stable = output
    .split("\n")
    .map((line) => line.split("\t")[1]?.replace("refs/tags/", ""))
    .filter((tag) => tag && STABLE_TAG.test(tag))
    .sort(compareStableTags);
  const base = manifest.upstream.tag;
  return {
    latest: stable.at(-1) ?? null,
    newer: stable.filter((tag) => compareStableTags(tag, base) > 0),
  };
}

const COMMIT_KINDS = [
  { kind: "pending", pattern: /^pending\(#\d+\): / },
  { kind: "seam", pattern: /^seam\(S\d+\): / },
  { kind: "delta", pattern: /^delta: / },
];
function readStack() {
  const output = git("log", "--reverse", "--format=%h%x09%s", `${manifest.upstream.commit}..HEAD`);
  const commits = (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      const match = COMMIT_KINDS.find(({ pattern }) => pattern.test(subject));
      return { hash, subject, kind: match?.kind ?? "other" };
    });
  // The stack must read pending -> seam -> delta from the base upward.
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

function readSeams() {
  const results = manifest.seams.map((seam) => {
    if (seam.status !== "applied") return { ...seam, ok: null };
    const path = join(repoRoot, seam.file);
    const needle = seam.contains ?? `[delta-seam:${seam.id}]`;
    const ok = existsSync(path) && readFileSync(path, "utf8").includes(needle);
    return { ...seam, ok };
  });
  // Markers in upstream files that delta.json does not list as applied.
  const grep = git("grep", "-n", "-o", "\\[delta-seam:S[0-9]*\\]", "--", ".", ":!delta/");
  const applied = new Set(manifest.seams.filter((s) => s.status === "applied").map((s) => s.id));
  const unlisted = (grep ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ location: line.replace(/:\[delta-seam:.*$/, ""), id: line.match(/S\d+/)[0] }))
    .filter(({ id }) => !applied.has(id));
  return { results, unlisted };
}

/**
 * Plugins live in delta/plugins/<id>/plugin.json. `testedUpstream` is the upstream tag the plugin
 * was last verified on; after an upstream update every plugin shows as needing verification
 * until someone checks it and bumps the field (borrowed from engines.t3 in upstream PR #33606).
 */
function readPlugins() {
  const pluginsDir = join(repoRoot, "delta/plugins");
  if (!existsSync(pluginsDir)) return [];
  const slotSeams = new Map(manifest.seams.filter((s) => s.slot).map((s) => [s.slot, s]));
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = join(pluginsDir, entry.name, "plugin.json");
      if (!existsSync(manifestPath)) return { folder: entry.name, issues: ["plugin.json 없음"] };
      let plugin;
      try {
        plugin = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (error) {
        return { folder: entry.name, issues: [`plugin.json을 읽을 수 없음: ${error.message}`] };
      }
      const issues = [];
      if (plugin.id !== entry.name) issues.push(`id(${plugin.id})가 폴더 이름과 다름`);
      const webPath = plugin.parts?.web;
      if (webPath && !existsSync(join(repoRoot, webPath))) issues.push(`웹 부분 경로 없음: ${webPath}`);
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

function readPending() {
  const ghAvailable = !offline && run("gh", ["--version"]) !== null;
  return manifest.pending.map((patch) => {
    if (!ghAvailable) return { ...patch, upstreamState: null };
    const state = run("gh", [
      "api",
      `repos/${manifest.upstream.repo}/pulls/${patch.pr}`,
      "--jq",
      'if .merged then "merged" else .state end',
    ]);
    return { ...patch, upstreamState: state };
  });
}

function collect() {
  return {
    product: manifest.product,
    version: buildVersion(),
    head: { branch: git("rev-parse", "--abbrev-ref", "HEAD"), commit: git("rev-parse", "--short", "HEAD") },
    base: readBase(),
    upstream: readLatestUpstream(),
    stack: readStack(),
    seams: readSeams(),
    pending: readPending(),
    plugins: readPlugins(),
  };
}

function problemsOf(report) {
  const problems = [];
  if (!report.base.inHead) problems.push(`기준 원본 커밋 ${report.base.commit.slice(0, 10)}이 HEAD에 없음`);
  if (report.base.tagMatchesCommit === false) problems.push(`태그 ${report.base.tag}가 delta.json의 커밋과 다름`);
  for (const seam of report.seams.results) {
    if (seam.ok === false) problems.push(`seam ${seam.id}가 ${seam.file}에 없음`);
  }
  for (const marker of report.seams.unlisted) {
    problems.push(`delta.json에 적용으로 등록되지 않은 seam 표시: ${marker.id} (${marker.location})`);
  }
  for (const commit of report.stack.commits.filter((c) => c.kind === "other")) {
    problems.push(`규칙 밖 커밋 메시지: ${commit.hash} ${commit.subject}`);
  }
  for (const commit of report.stack.outOfOrder) {
    problems.push(`스택 순서 위반(pending → seam → delta): ${commit.hash} ${commit.subject}`);
  }
  for (const patch of report.pending) {
    if (patch.status === "applied" && patch.upstreamState === "merged") {
      problems.push(`${patch.id} #${patch.pr}가 원본에 머지됨: 임시 패치 커밋을 빼야 함`);
    }
  }
  for (const plugin of report.plugins) {
    for (const issue of plugin.issues) problems.push(`플러그인 ${plugin.folder}: ${issue}`);
    if (plugin.issues.length === 0 && plugin.enabled !== false && !plugin.verified) {
      problems.push(
        `플러그인 ${plugin.folder}: ${report.base.tag}에서 재검증 필요 (마지막 확인 ${plugin.testedUpstream ?? "없음"})`,
      );
    }
  }
  return problems;
}

function printStatus(report) {
  const short = (sha) => sha.slice(0, 10);
  const counts = Object.fromEntries(["pending", "seam", "delta", "other"].map((k) => [k, 0]));
  for (const commit of report.stack.commits) counts[commit.kind] += 1;
  const lines = [
    `${report.product}  ${report.version}`,
    "",
    `기준 원본   ${report.base.tag} (${short(report.base.commit)})${report.base.inHead ? "" : "  ⚠ HEAD에 없음"}`,
  ];
  if (report.upstream === null) {
    lines.push("최신 원본   확인 못 함 (--offline 또는 네트워크 오류)");
  } else if (report.upstream.newer.length === 0) {
    lines.push(`최신 원본   ${report.upstream.latest} → 최신 상태`);
  } else {
    lines.push(
      `최신 원본   ${report.upstream.latest} → 새 정식 릴리스 ${report.upstream.newer.length}개 (${report.upstream.newer.join(", ")}). 동기화 필요`,
    );
  }
  lines.push(
    `현재        ${report.head.branch} @ ${report.head.commit}, 기준 위 커밋 ${report.stack.commits.length}개 ` +
      `(pending ${counts.pending} · seam ${counts.seam} · delta ${counts.delta}${counts.other ? ` · 규칙 밖 ${counts.other}` : ""})`,
  );
  const seamText = report.seams.results
    .map((s) => `${s.id} ${s.ok === true ? "적용✓" : s.ok === false ? "누락✗" : s.status === "planned" ? "예정" : "선택"}`)
    .join(" · ");
  lines.push(`seam        ${seamText}`);
  const pendingText = report.pending
    .map((p) => `${p.id} #${p.pr} ${p.status === "applied" ? "적용" : p.status === "planned" ? "예정" : "선택"}(원본 ${p.upstreamState ?? "?"})`)
    .join(" · ");
  lines.push(`pending     ${pendingText}`);
  const pluginText =
    report.plugins.length === 0
      ? "없음"
      : report.plugins
          .map((p) => {
            const state = p.issues.length > 0 ? "문제✗" : p.enabled === false ? "꺼짐" : p.verified ? "확인✓" : "재검증 필요";
            return `${p.folder}${p.version ? ` ${p.version}` : ""} ${state}`;
          })
          .join(" · ");
  lines.push(`플러그인    ${pluginText}`);
  const problems = problemsOf(report);
  lines.push("", problems.length === 0 ? "규칙 위반 없음" : `문제 ${problems.length}개:`);
  for (const problem of problems) lines.push(`  - ${problem}`);
  console.log(lines.join("\n"));
}

if (command === "version") {
  console.log(buildVersion());
} else if (command === "status" || command === "check") {
  const report = collect();
  const problems = problemsOf(report);
  if (asJson) console.log(JSON.stringify({ ...report, problems }, null, 2));
  else if (command === "status") printStatus(report);
  else for (const problem of problems) console.error(problem);
  if (command === "check" && problems.length > 0) process.exit(1);
} else {
  console.error(`알 수 없는 명령: ${command}. status, version, check 중 하나를 쓰세요.`);
  process.exit(2);
}
