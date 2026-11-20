// `delta.mjs sync`: moves the stack onto a newer stable upstream tag after its review.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  STABLE_TAG,
  args,
  compareStableTags,
  ensureTag,
  fail,
  git,
  gitInherit,
  manifest,
  offline,
  originRepo,
  positional,
  readHotfixes,
  readLatestUpstream,
  readPending,
  readStack,
  rebaseInProgress,
  repoRoot,
  reviewPath,
  syncStatePath,
  writeManifest,
} from "./core.mjs";

/** Rebase sequence editor: turns the picks of dropped commits into drops. */
export function editTodo(todoPath) {
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

export function syncStart(cliPath) {
  if (NodeFS.existsSync(syncStatePath()))
    fail("동기화가 이미 진행 중이다. `delta.mjs sync --continue` 또는 `--abort`를 쓴다.");
  if (rebaseInProgress()) fail("git rebase가 진행 중이다. 먼저 끝내거나 중단한다.");
  // Untracked files (such as a new review report) do not block a rebase.
  if (git("status", "--porcelain", "--untracked-files=no") !== "")
    fail("작업 트리에 커밋하지 않은 변경이 있다. 커밋하거나 치운 뒤 다시 실행한다.");
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
  const review = reviewPath(base, target);
  if (!NodeFS.existsSync(NodePath.join(repoRoot, review))) {
    fail(
      [
        `검토 보고서 ${review}가 없다. 원본에서 무엇이 바뀌었는지 먼저 확인한다:`,
        `  node delta/scripts/delta.mjs review ${target}`,
        "보고서를 읽고 직접 수정(H)마다 유지할지 정한 뒤 다시 sync한다.",
      ].join("\n"),
    );
  }
  const targetCommit = ensureTag(target);

  const stack = readStack();
  const droppedPending = readPending(stack, target).filter(
    (p) => p.status === "applied" && p.commit && p.inLatest === true,
  );
  const retiredFixes = readHotfixes(stack, target).filter(
    (f) => f.status === "retired" && f.commit,
  );
  const dropHashes = new Set([
    ...droppedPending.map((p) => p.commit),
    ...retiredFixes.map((f) => f.commit),
  ]);
  const keep = stack.commits.filter((c) => !dropHashes.has(c.hash));

  const plan = [
    `동기화 계획: ${base} → ${target} (${targetCommit.slice(0, 10)}), 브랜치 ${branch}`,
    `  검토 보고서: ${review}`,
    `  다시 쌓을 커밋 ${keep.length}개:`,
    ...keep.map((c) => `    ${c.hash} ${c.subject}`),
    `  뺄 임시 패치 ${droppedPending.length}개${droppedPending.length ? " (새 태그에 들어 있음):" : ""}`,
    ...droppedPending.map((p) => `    ${p.id} #${p.pr} ${p.commit}`),
    `  뺄 직접 수정 ${retiredFixes.length}개${retiredFixes.length ? " (delta.json에서 retired):" : ""}`,
    ...retiredFixes.map((f) => `    ${f.id} ${f.commit}`),
  ];
  console.log(plan.join("\n"));
  if (args.includes("--dry-run")) return;

  const backup = `backup/${branch}-${base}-r${manifest.revision}`;
  if (git("rev-parse", "--verify", "--quiet", `refs/heads/${backup}`) === null)
    git("branch", backup, "HEAD");
  console.log(`백업 브랜치: ${backup}`);
  const state = {
    from: base,
    to: target,
    toCommit: targetCommit,
    branch,
    backup,
    review,
    droppedPending: droppedPending.map(({ id, pr }) => ({ id, pr })),
    retiredFixes: retiredFixes.map(({ id }) => id),
  };
  NodeFS.writeFileSync(syncStatePath(), JSON.stringify(state, null, 2));

  const toPosix = (path) => path.replaceAll("\\", "/");
  const editor = `"${toPosix(process.execPath)}" "${toPosix(cliPath)}" __edit-todo`;
  const ok = gitInherit(
    ["rebase", "-i", "--empty=drop", "--onto", target, manifest.upstream.commit, branch],
    {
      GIT_SEQUENCE_EDITOR: editor,
      DELTA_SYNC_DROP: stack.commits
        .filter((c) => dropHashes.has(c.hash))
        .map((c) => c.fullHash)
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
  syncFinish(cliPath);
}

export function syncFinish(cliPath) {
  if (!NodeFS.existsSync(syncStatePath())) fail("진행 중인 동기화가 없다.");
  if (rebaseInProgress())
    fail("리베이스가 아직 끝나지 않았다. 충돌을 고치고 `git rebase --continue`부터 끝낸다.");
  const state = JSON.parse(NodeFS.readFileSync(syncStatePath(), "utf8"));
  if (git("merge-base", "--is-ancestor", state.toCommit, "HEAD") === null) {
    fail(`HEAD가 ${state.to} 위에 있지 않다. 리베이스가 끝났는지 확인한다.`);
  }
  const droppedPrs = new Set(state.droppedPending.map((p) => p.pr));
  const retired = new Set(state.retiredFixes);
  writeManifest({
    ...manifest,
    revision: 1,
    upstream: { ...manifest.upstream, tag: state.to, commit: state.toCommit },
    pending: manifest.pending.filter((p) => !droppedPrs.has(p.pr)),
    hotfixes: (manifest.hotfixes ?? []).filter((f) => !retired.has(f.id)),
  });
  const removed = [...state.droppedPending.map((p) => `${p.id} #${p.pr}`), ...state.retiredFixes];
  const body = [
    `delta: sync to upstream ${state.to}`,
    "",
    `Rebased the stack from ${state.from} onto ${state.to} (${state.toCommit.slice(0, 10)}).`,
    `Review: ${state.review}`,
    ...(removed.length ? [`Removed fixes upstream now covers: ${removed.join(", ")}.`] : []),
  ].join("\n");
  const paths = ["delta/delta.json"];
  if (NodeFS.existsSync(NodePath.join(repoRoot, state.review))) {
    git("add", "--", state.review);
    paths.push(state.review);
  }
  if (!gitInherit(["commit", "--quiet", "-m", body, "--", ...paths])) fail("커밋에 실패했다.");
  NodeFS.rmSync(syncStatePath());

  const after = NodeChildProcess.execFileSync(
    process.execPath,
    [cliPath, "status", ...(offline ? ["--offline"] : [])],
    { cwd: repoRoot, encoding: "utf8" },
  );
  console.log(`\n${after}`);
  console.log(
    [
      "남은 일:",
      ...(removed.length
        ? [`- delta/PATCHNOTES.md에서 ${removed.join(", ")}를 '지난 수정'으로 옮긴다`]
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

export function syncAbort() {
  if (rebaseInProgress()) gitInherit(["rebase", "--abort"]);
  if (NodeFS.existsSync(syncStatePath())) {
    const state = JSON.parse(NodeFS.readFileSync(syncStatePath(), "utf8"));
    NodeFS.rmSync(syncStatePath());
    console.log(`동기화를 멈췄다. 리베이스 전 상태는 백업 브랜치 ${state.backup}에 있다.`);
  } else {
    console.log("진행 중인 동기화가 없다.");
  }
}
