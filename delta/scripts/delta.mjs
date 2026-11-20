#!/usr/bin/env node
// T3 Code - Delta fork helper: which upstream release the fork is on, whether the fork's
// seams, pending patches, commit stack and plugins match delta/delta.json, and moving the
// fork onto a new upstream release. Needs only Node, git, and optionally gh. See USAGE.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const USAGE = `Usage: node delta/scripts/delta.mjs <command> [options]
  status                 (default) human-readable report. --json for machines
  version                prints the build version for APP_VERSION, e.g. 0.1.10+delta.1
  check                  exits 1 when the fork breaks its own rules
  sync [<tag>]           rebases the stack onto the newest (or given) stable upstream tag,
                         drops pending patches that tag already contains, updates delta.json
    --dry-run            prints the plan only
    --continue           finishes after the rebase completed (git rebase --continue)
    --abort              stops a sync whose rebase is still running
  themes                 lists plugin themes. --install copies them into T3's themes folder
    --home <dir>         T3 data folder (default: T3CODE_HOME, else ~/.t3)
  help                   prints this
Common options: --offline skips network reads (latest upstream tag, pull request states).`;

const scriptPath = NodeURL.fileURLToPath(import.meta.url);
const repoRoot = NodePath.resolve(NodePath.dirname(scriptPath), "../..");
const manifestPath = NodePath.join(repoRoot, "delta/delta.json");
const manifest = JSON.parse(NodeFS.readFileSync(manifestPath, "utf8"));
const args = process.argv.slice(2);
const flagValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--home",
);
const command = positional[0] ?? "status";
const asJson = args.includes("--json");
const offline = args.includes("--offline");

/** Runs a command in the repo root. Returns trimmed stdout, or null when it fails. */
function run(cmd, cmdArgs, options = {}) {
  try {
    return NodeChildProcess.execFileSync(cmd, cmdArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch {
    return null;
  }
}
const git = (...gitArgs) => run("git", gitArgs);
const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

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
  { kind: "pending", pattern: /^pending\(#(\d+)\): / },
  { kind: "seam", pattern: /^seam\(S\d+\): / },
  { kind: "delta", pattern: /^delta: / },
];
function readStack() {
  const output = git("log", "--reverse", "--format=%H%x09%s", `${manifest.upstream.commit}..HEAD`);
  const commits = (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullHash, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      const match = COMMIT_KINDS.find(({ pattern }) => pattern.test(subject));
      const pr = match?.kind === "pending" ? Number(subject.match(match.pattern)[1]) : undefined;
      return { hash: fullHash.slice(0, 10), fullHash, subject, kind: match?.kind ?? "other", pr };
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
    const path = NodePath.join(repoRoot, seam.file);
    const needle = seam.contains ?? `[delta-seam:${seam.id}]`;
    const ok = NodeFS.existsSync(path) && NodeFS.readFileSync(path, "utf8").includes(needle);
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
 * until someone checks it and bumps the field.
 */
function readPlugins() {
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
function tagContains(tag, sha) {
  const local =
    git("cat-file", "-e", `${sha}^{commit}`) !== null &&
    git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`) !== null;
  if (local) return git("merge-base", "--is-ancestor", sha, tag) !== null;
  if (offline) return null;
  const status = run("gh", [
    "api",
    `repos/${manifest.upstream.repo}/compare/${tag}...${sha}`,
    "--jq",
    ".status",
  ]);
  if (status === null) return null;
  // compare base...head: "behind" or "identical" means the tag already has the commit.
  return status === "behind" || status === "identical";
}

/**
 * A pending patch leaves the stack only when a stable tag contains its upstream merge.
 * Merged on upstream main is not enough: the fork builds from release tags.
 */
function readPending(stack, latest) {
  const ghAvailable = !offline && run("gh", ["--version"]) !== null;
  return manifest.pending.map((patch) => {
    const commit = stack.commits.find((c) => c.kind === "pending" && c.pr === patch.pr);
    const result = {
      ...patch,
      commit: commit?.hash ?? null,
      upstreamState: null,
      inBase: null,
      inLatest: null,
    };
    if (!ghAvailable) return result;
    const info = run("gh", [
      "api",
      `repos/${manifest.upstream.repo}/pulls/${patch.pr}`,
      "--jq",
      '[(if .merged then "merged" else .state end), (.merge_commit_sha // "")] | @tsv',
    ]);
    if (info === null) return result;
    const [state, mergeCommit] = info.split("\t");
    result.upstreamState = state;
    if (state === "merged" && mergeCommit) {
      result.mergeCommit = mergeCommit;
      result.inBase = tagContains(manifest.upstream.tag, mergeCommit);
      if (latest && latest !== manifest.upstream.tag)
        result.inLatest = tagContains(latest, mergeCommit);
    }
    return result;
  });
}

const syncStatePath = () =>
  NodePath.resolve(
    repoRoot,
    git("rev-parse", "--git-path", "delta-sync.json") ?? ".git/delta-sync.json",
  );
const rebaseInProgress = () =>
  ["rebase-merge", "rebase-apply"].some((name) =>
    NodeFS.existsSync(NodePath.resolve(repoRoot, git("rev-parse", "--git-path", name))),
  );

function collect() {
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
    plugins: readPlugins(),
    syncInProgress: NodeFS.existsSync(syncStatePath()),
  };
}

function problemsOf(report) {
  const problems = [];
  if (!report.base.inHead)
    problems.push(`기준 원본 커밋 ${report.base.commit.slice(0, 10)}이 HEAD에 없음`);
  if (report.base.tagMatchesCommit === false)
    problems.push(`태그 ${report.base.tag}가 delta.json의 커밋과 다름`);
  for (const seam of report.seams.results) {
    if (seam.ok === false) problems.push(`seam ${seam.id}가 ${seam.file}에 없음`);
  }
  for (const marker of report.seams.unlisted) {
    problems.push(
      `delta.json에 적용으로 등록되지 않은 seam 표시: ${marker.id} (${marker.location})`,
    );
  }
  for (const commit of report.stack.commits.filter((c) => c.kind === "other")) {
    problems.push(`규칙 밖 커밋 메시지: ${commit.hash} ${commit.subject}`);
  }
  for (const commit of report.stack.outOfOrder) {
    problems.push(`스택 순서 위반(pending → seam → delta): ${commit.hash} ${commit.subject}`);
  }
  const listed = new Set(manifest.pending.map((p) => p.pr));
  for (const commit of report.stack.commits.filter(
    (c) => c.kind === "pending" && !listed.has(c.pr),
  )) {
    problems.push(`delta.json에 없는 임시 패치 커밋: ${commit.hash} ${commit.subject}`);
  }
  for (const patch of report.pending) {
    if (patch.status === "applied" && !patch.commit) {
      problems.push(
        `${patch.id} #${patch.pr}가 적용으로 등록됐지만 pending(#${patch.pr}) 커밋이 없음`,
      );
    }
    if (patch.status !== "applied" && patch.commit) {
      problems.push(
        `${patch.id} #${patch.pr} 커밋(${patch.commit})이 있는데 delta.json 상태가 applied가 아님`,
      );
    }
    if (patch.status === "applied" && patch.inBase === true) {
      problems.push(
        `${patch.id} #${patch.pr}가 기준 원본 ${report.base.tag}에 이미 들어 있음: 임시 패치 커밋을 빼야 함`,
      );
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

function pendingLabel(patch, latest) {
  const status = patch.status === "applied" ? "적용" : patch.status === "planned" ? "예정" : "선택";
  let upstream = `원본 ${patch.upstreamState ?? "?"}`;
  if (patch.upstreamState === "merged") {
    if (patch.inBase) upstream += `, ${manifest.upstream.tag}에 포함`;
    else if (patch.inLatest) upstream += `, ${latest}에 포함 → 동기화 때 빠짐`;
    else if (patch.inBase === false) upstream += ", 정식 릴리스 대기";
  }
  return `${patch.id} #${patch.pr} ${status}(${upstream})`;
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
      `최신 원본   ${report.upstream.latest} → 새 정식 릴리스 ${report.upstream.newer.length}개 (${report.upstream.newer.join(", ")}). ` +
        "`delta.mjs sync`로 동기화",
    );
  }
  lines.push(
    `현재        ${report.head.branch} @ ${report.head.commit}, 기준 위 커밋 ${report.stack.commits.length}개 ` +
      `(pending ${counts.pending} · seam ${counts.seam} · delta ${counts.delta}${counts.other ? ` · 규칙 밖 ${counts.other}` : ""})`,
  );
  if (report.syncInProgress)
    lines.push("            ⚠ 동기화 진행 중: `delta.mjs sync --continue` 또는 `--abort`");
  const seamText = report.seams.results
    .map(
      (s) =>
        `${s.id} ${s.ok === true ? "적용✓" : s.ok === false ? "누락✗" : s.status === "planned" ? "예정" : "선택"}`,
    )
    .join(" · ");
  lines.push(`seam        ${seamText}`);
  const pendingText =
    report.pending.length === 0
      ? "없음"
      : report.pending.map((p) => pendingLabel(p, report.upstream?.latest)).join(" · ");
  lines.push(`pending     ${pendingText}`);
  const pluginText =
    report.plugins.length === 0
      ? "없음"
      : report.plugins
          .map((p) => {
            const state =
              p.issues.length > 0
                ? "문제✗"
                : p.enabled === false
                  ? "꺼짐"
                  : p.verified
                    ? "확인✓"
                    : "재검증 필요";
            return `${p.folder}${p.version ? ` ${p.version}` : ""} ${state}`;
          })
          .join(" · ");
  lines.push(`플러그인    ${pluginText}`);
  const problems = problemsOf(report);
  lines.push("", problems.length === 0 ? "규칙 위반 없음" : `문제 ${problems.length}개:`);
  for (const problem of problems) lines.push(`  - ${problem}`);
  console.log(lines.join("\n"));
}

/** delta.json keeps one line per seam and pending entry so diffs stay readable. */
function writeManifest(next) {
  const inline = (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? `{ ${Object.entries(value)
          .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
          .join(", ")} }`
      : JSON.stringify(value);
  const field = ([key, value]) => {
    if (Array.isArray(value)) {
      return value.length === 0
        ? `  ${JSON.stringify(key)}: []`
        : `  ${JSON.stringify(key)}: [\n${value.map((item) => `    ${inline(item)}`).join(",\n")}\n  ]`;
    }
    if (value && typeof value === "object") {
      const inner = Object.entries(value).map(
        ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
      );
      return `  ${JSON.stringify(key)}: {\n${inner.join(",\n")}\n  }`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  };
  NodeFS.writeFileSync(manifestPath, `{\n${Object.entries(next).map(field).join(",\n")}\n}\n`);
}

function gitInherit(gitArgs, env) {
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

/** Rebase sequence editor: turns the picks of dropped pending commits into drops. */
function editTodo(todoPath) {
  const drop = (process.env.DELTA_SYNC_DROP ?? "").split(",").filter(Boolean);
  const todo = NodeFS.readFileSync(todoPath, "utf8")
    .split("\n")
    .map((line) => {
      const match = line.match(/^(pick|p)\s+([0-9a-f]+)(.*)$/);
      return match && drop.some((hash) => hash.startsWith(match[2]))
        ? `drop ${match[2]}${match[3]}`
        : line;
    });
  NodeFS.writeFileSync(todoPath, todo.join("\n"));
}

function syncStart() {
  if (NodeFS.existsSync(syncStatePath()))
    fail("동기화가 이미 진행 중이다. `delta.mjs sync --continue` 또는 `--abort`를 쓴다.");
  if (rebaseInProgress()) fail("git rebase가 진행 중이다. 먼저 끝내거나 중단한다.");
  if (git("status", "--porcelain") !== "")
    fail("작업 트리가 깨끗하지 않다. 커밋하거나 치운 뒤 다시 실행한다.");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const base = manifest.upstream.tag;

  let target = positional[1];
  if (!target) {
    const upstream = readLatestUpstream();
    if (upstream === null)
      fail("원본 태그를 읽지 못했다. 네트워크를 확인하거나 태그를 직접 준다: sync v0.1.11");
    target = upstream.latest;
  }
  if (!STABLE_TAG.test(target)) fail(`정식 릴리스 태그(vX.Y.Z)만 쓴다: ${target}`);
  if (compareStableTags(target, base) <= 0) {
    console.log(`이미 ${base} 위에 있다. ${target}은 더 새롭지 않다.`);
    return;
  }

  if (git("rev-parse", "--verify", "--quiet", `refs/tags/${target}`) === null) {
    console.log(`원본 ${target} 태그를 가져온다…`);
    if (
      !gitInherit(["fetch", "--no-tags", "upstream", `+refs/tags/${target}:refs/tags/${target}`])
    ) {
      fail(`upstream에서 ${target}을 가져오지 못했다.`);
    }
  }
  const targetCommit = git("rev-parse", `${target}^{commit}`);

  const stack = readStack();
  const pending = readPending(stack, target);
  const dropped = pending.filter(
    (p) => p.status === "applied" && p.commit && tagContains(target, p.mergeCommit ?? "") === true,
  );
  const unknown = pending.filter((p) => p.status === "applied" && p.upstreamState === null);
  const keep = stack.commits.filter((c) => !dropped.some((p) => p.commit === c.hash));

  const plan = [
    `동기화 계획: ${base} → ${target} (${targetCommit.slice(0, 10)}), 브랜치 ${branch}`,
    `  다시 쌓을 커밋 ${keep.length}개:`,
    ...keep.map((c) => `    ${c.hash} ${c.subject}`),
    `  뺄 임시 패치 ${dropped.length}개${dropped.length ? " (새 태그에 이미 들어 있음):" : ""}`,
    ...dropped.map((p) => `    ${p.id} #${p.pr} ${p.commit}`),
  ];
  if (unknown.length)
    plan.push(`  ⚠ 원본 상태를 못 읽은 패치: ${unknown.map((p) => p.id).join(", ")} (그대로 둔다)`);
  console.log(plan.join("\n"));
  if (args.includes("--dry-run")) return;

  const backup = `backup/${branch}-${base}-r${manifest.revision}`;
  if (git("rev-parse", "--verify", "--quiet", `refs/heads/${backup}`) === null)
    git("branch", backup, "HEAD");
  console.log(`백업 브랜치: ${backup}`);
  NodeFS.writeFileSync(
    syncStatePath(),
    JSON.stringify(
      {
        from: base,
        to: target,
        toCommit: targetCommit,
        branch,
        backup,
        dropped: dropped.map(({ id, pr }) => ({ id, pr })),
      },
      null,
      2,
    ),
  );

  const editor = `"${process.execPath.replaceAll("\\", "/")}" "${scriptPath.replaceAll("\\", "/")}" __edit-todo`;
  const ok = gitInherit(
    ["rebase", "-i", "--empty=drop", "--onto", target, manifest.upstream.commit, branch],
    {
      GIT_SEQUENCE_EDITOR: editor,
      DELTA_SYNC_DROP: dropped
        .map((p) => stack.commits.find((c) => c.hash === p.commit).fullHash)
        .join(","),
    },
  );
  if (!ok) {
    console.error(
      [
        "",
        "리베이스가 충돌로 멈췄다. rerere가 기억한 해결은 이미 적용됐다.",
        "1. delta/LOCAL_PATCHES.md의 기준점대로 충돌을 고친다. 생성 파일은 원본 것을 받고 다시 만든다.",
        "2. git add <파일> 후 git rebase --continue (끝날 때까지 반복)",
        "3. node delta/scripts/delta.mjs sync --continue",
        "그만두려면: node delta/scripts/delta.mjs sync --abort",
      ].join("\n"),
    );
    process.exit(1);
  }
  syncFinish();
}

function syncFinish() {
  if (!NodeFS.existsSync(syncStatePath())) fail("진행 중인 동기화가 없다.");
  if (rebaseInProgress())
    fail("리베이스가 아직 끝나지 않았다. 충돌을 고치고 `git rebase --continue`부터 끝낸다.");
  const state = JSON.parse(NodeFS.readFileSync(syncStatePath(), "utf8"));
  if (git("merge-base", "--is-ancestor", state.toCommit, "HEAD") === null) {
    fail(`HEAD가 ${state.to} 위에 있지 않다. 리베이스가 끝났는지 확인한다.`);
  }
  const droppedPrs = new Set(state.dropped.map((p) => p.pr));
  const next = {
    ...manifest,
    revision: 1,
    upstream: { ...manifest.upstream, tag: state.to, commit: state.toCommit },
    pending: manifest.pending.filter((p) => !droppedPrs.has(p.pr)),
  };
  writeManifest(next);
  const body = [
    `delta: sync to upstream ${state.to}`,
    "",
    `Rebased the stack from ${state.from} onto ${state.to} (${state.toCommit.slice(0, 10)}).`,
    ...(state.dropped.length
      ? [
          `Dropped pending patches that ${state.to} contains: ${state.dropped.map((p) => `${p.id} #${p.pr}`).join(", ")}.`,
        ]
      : []),
  ].join("\n");
  if (!gitInherit(["commit", "--quiet", "-m", body, "--", "delta/delta.json"]))
    fail("delta.json 커밋에 실패했다.");
  NodeFS.rmSync(syncStatePath());

  // Re-read with the new manifest.
  const after = NodeChildProcess.execFileSync(
    process.execPath,
    [scriptPath, "status", ...(offline ? ["--offline"] : [])],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  console.log(`\n${after}`);
  console.log(
    [
      "남은 일:",
      ...(state.dropped.length
        ? [
            `- delta/LOCAL_PATCHES.md에서 ${state.dropped.map((p) => p.id).join(", ")} 행을 '지난 임시 패치'로 옮긴다`,
          ]
        : []),
      "- vp i, vp run check:changed",
      `- 플러그인마다 ${state.to}에서 동작을 확인하고 plugin.json의 testedUpstream을 올린다`,
      "- node delta/scripts/delta.mjs check",
      `- git push --force-with-lease origin ${state.branch}`,
      `- gh repo sync ${originRepo() ?? "<owner>/t3code-delta"} -b main`,
      `- 문제가 생기면 백업 브랜치 ${state.backup}로 되돌린다`,
    ].join("\n"),
  );
}

function syncAbort() {
  if (rebaseInProgress()) gitInherit(["rebase", "--abort"]);
  if (NodeFS.existsSync(syncStatePath())) {
    const state = JSON.parse(NodeFS.readFileSync(syncStatePath(), "utf8"));
    NodeFS.rmSync(syncStatePath());
    console.log(`동기화를 멈췄다. 리베이스 전 상태는 백업 브랜치 ${state.backup}에 있다.`);
  } else {
    console.log("진행 중인 동기화가 없다.");
  }
}

function originRepo() {
  const url = git("remote", "get-url", "origin");
  return url?.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1] ?? null;
}

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

function themes() {
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

if (command === "__edit-todo") {
  editTodo(positional[1]);
} else if (command === "version") {
  console.log(buildVersion());
} else if (command === "status" || command === "check") {
  const report = collect();
  const problems = problemsOf(report);
  if (asJson) console.log(JSON.stringify({ ...report, problems }, null, 2));
  else if (command === "status") printStatus(report);
  else for (const problem of problems) console.error(problem);
  if (command === "check" && problems.length > 0) process.exit(1);
} else if (command === "sync") {
  if (args.includes("--continue")) syncFinish();
  else if (args.includes("--abort")) syncAbort();
  else syncStart();
} else if (command === "themes") {
  themes();
} else if (command === "help" || args.includes("--help")) {
  console.log(USAGE);
} else {
  fail(
    `알 수 없는 명령: ${command}

${USAGE}`,
    2,
  );
}
