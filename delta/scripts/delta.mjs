#!/usr/bin/env node
// T3 Code - Delta fork helper: which upstream release the fork is on, whether its fixes, seams,
// commit stack and plugins match delta/delta.json, what an upstream update brings, and moving
// the fork onto it. Needs only Node, git, and optionally gh. Modules live in ./lib. See USAGE.
import * as NodeURL from "node:url";

import {
  STACK_ORDER,
  args,
  buildVersion,
  collect,
  fail,
  manifest,
  positional,
  problemsOf,
} from "./lib/core.mjs";
import { review } from "./lib/review.mjs";
import { editTodo, syncAbort, syncFinish, syncStart } from "./lib/sync.mjs";
import { themes } from "./lib/themes.mjs";

const USAGE = `Usage: node delta/scripts/delta.mjs <command> [options]
  status                 (default) human-readable report. --json for machines
  version                prints the build version for APP_VERSION, e.g. 0.1.10+delta.1
  check                  exits 1 when the fork breaks its own rules
  review [<tag>]         what upstream <tag> (default: newest stable) changes and what that
                         means for the fork's fixes, seams and plugins. Writes
                         delta/reviews/<base>..<tag>.md, which sync requires
    --nightly            previews the newest nightly instead
  sync [<tag>]           rebases the stack onto the newest (or given) stable upstream tag,
                         drops pending patches that tag contains and retired hotfixes
    --dry-run            prints the plan only
    --continue           finishes after the rebase completed (git rebase --continue)
    --abort              stops a sync whose rebase is still running
  themes                 lists plugin themes. --install copies them into T3's themes folder
    --home <dir>         T3 data folder (default: T3CODE_HOME, else ~/.t3)
  help                   prints this
Commit stack, from the base tag up: ${STACK_ORDER}
Common options: --offline skips network reads (upstream tags, issue and pull request states).`;

const cliPath = NodeURL.fileURLToPath(import.meta.url);
const command = positional[0] ?? "status";
const midSync = command === "sync" && (args.includes("--continue") || args.includes("--abort"));
if (manifest === null && !midSync && command !== "__edit-todo" && command !== "help") {
  fail(
    "delta/delta.json이 없다. 동기화 리베이스가 멈춘 중이라면 충돌 안내에 나온 " +
      "`node <git 폴더>/delta-sync-tool/delta.mjs sync --continue` 또는 `--abort`를 쓴다.",
  );
}

function prSuffix(item, latest) {
  if (item.prState !== "merged") return item.prState ?? "?";
  if (item.inBase) return `merged, ${manifest.upstream.tag}에 포함`;
  if (item.inLatest) return `merged, ${latest}에 포함 → 동기화 때 빠짐`;
  return item.inBase === false ? "merged, 정식 릴리스 대기" : "merged";
}

function pendingLabel(patch, latest) {
  const status = patch.status === "applied" ? "적용" : patch.status === "planned" ? "예정" : "선택";
  return `${patch.id} #${patch.pr} ${status}(원본 ${prSuffix(patch, latest)})`;
}

function hotfixLabel(fix, latest) {
  const status =
    fix.status === "applied" ? "적용" : fix.status === "retired" ? "빼기로 함" : fix.status;
  const tracking = [
    fix.issue ? `이슈 #${fix.issue} ${fix.issueState ?? "?"}` : null,
    fix.pr ? `PR #${fix.pr} ${prSuffix(fix, latest)}` : null,
  ].filter(Boolean);
  return `${fix.id} ${status}(${tracking.join(" · ") || "원본 추적 없음"})`;
}

function printStatus(report) {
  const short = (sha) => sha.slice(0, 10);
  const counts = Object.fromEntries(
    ["pending", "hotfix", "seam", "delta", "other"].map((k) => [k, 0]),
  );
  for (const commit of report.stack.commits) counts[commit.kind] += 1;
  const latest = report.upstream?.latest;
  const lines = [
    `${report.product}  ${report.version}`,
    "",
    `기준 원본   ${report.base.tag} (${short(report.base.commit)})${report.base.inHead ? "" : "  ⚠ HEAD에 없음"}`,
  ];
  if (report.upstream === null) {
    lines.push("최신 원본   확인 못 함 (--offline 또는 네트워크 오류)");
  } else if (report.upstream.newer.length === 0) {
    lines.push(`최신 원본   ${latest} → 최신 상태`);
  } else {
    lines.push(
      `최신 원본   ${latest} → 새 정식 릴리스 ${report.upstream.newer.length}개 (${report.upstream.newer.join(", ")}). ` +
        "`delta.mjs review`로 검토 후 `sync`",
    );
  }
  lines.push(
    `현재        ${report.head.branch} @ ${report.head.commit}, 기준 위 커밋 ${report.stack.commits.length}개 ` +
      `(pending ${counts.pending} · hotfix ${counts.hotfix} · seam ${counts.seam} · delta ${counts.delta}` +
      `${counts.other ? ` · 규칙 밖 ${counts.other}` : ""})`,
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
  const list = (items, label) => (items.length === 0 ? "없음" : items.map(label).join(" · "));
  lines.push(`hotfix      ${list(report.hotfixes, (f) => hotfixLabel(f, latest))}`);
  lines.push(`pending     ${list(report.pending, (p) => pendingLabel(p, latest))}`);
  lines.push(
    `플러그인    ${list(report.plugins, (p) => {
      const state =
        p.issues.length > 0
          ? "문제✗"
          : p.enabled === false
            ? "꺼짐"
            : p.verified
              ? "확인✓"
              : "재검증 필요";
      return `${p.folder}${p.version ? ` ${p.version}` : ""} ${state}`;
    })}`,
  );
  const problems = problemsOf(report);
  lines.push("", problems.length === 0 ? "규칙 위반 없음" : `문제 ${problems.length}개:`);
  for (const problem of problems) lines.push(`  - ${problem}`);
  console.log(lines.join("\n"));
}

if (command === "__edit-todo") {
  editTodo(positional[1]);
} else if (command === "version") {
  console.log(buildVersion());
} else if (command === "status" || command === "check") {
  const report = collect();
  const problems = problemsOf(report);
  if (args.includes("--json")) console.log(JSON.stringify({ ...report, problems }, null, 2));
  else if (command === "status") printStatus(report);
  else for (const problem of problems) console.error(problem);
  if (command === "check" && problems.length > 0) process.exit(1);
} else if (command === "review") {
  review();
} else if (command === "sync") {
  if (args.includes("--continue")) syncFinish();
  else if (args.includes("--abort")) syncAbort();
  else syncStart(cliPath);
} else if (command === "themes") {
  themes();
} else if (command === "help" || args.includes("--help")) {
  console.log(USAGE);
} else {
  fail(`알 수 없는 명령: ${command}\n\n${USAGE}`, 2);
}
