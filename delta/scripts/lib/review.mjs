// `delta.mjs review`: what an upstream update brings and what it means for the fork, written to
// delta/reviews/<base>..<target>.md before `sync` moves the stack.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  STABLE_TAG,
  UPSTREAM_URL,
  args,
  compareStableTags,
  ensureTag,
  ghApi,
  git,
  manifest,
  positional,
  readHotfixes,
  readPending,
  readPlugins,
  readStack,
  readUpstreamTags,
  repoRoot,
  reviewPath,
} from "./core.mjs";

const MAX_LISTED = 12;
const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const prLink = (pr) => `[#${pr}](${UPSTREAM_URL}/pull/${pr})`;
const issueLink = (issue) => `[#${issue}](${UPSTREAM_URL}/issues/${issue})`;
// Upstream subjects end with a pull request reference; bare references here would link to the fork.
const linkSubject = (subject) => subject.replace(/\(#(\d+)\)/g, (_, pr) => `(${prLink(pr)})`);

function commitsIn(range, extra) {
  const output = git("log", "--format=%h%x09%s", ...extra, range);
  return (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      return { hash, subject: rest.join("\t") };
    });
}
const touching = (range, files) => (files.length ? commitsIn(range, ["--", ...files]) : []);
const mentioning = (range, keywords) =>
  keywords.length ? commitsIn(range, ["-i", ...keywords.map((k) => `--grep=${k}`)]) : [];

function commitList(commits) {
  if (commits.length === 0) return [];
  const shown = commits
    .slice(0, MAX_LISTED)
    .map((c) => `- [\`${c.hash}\`](${UPSTREAM_URL}/commit/${c.hash}) ${linkSubject(c.subject)}`);
  if (commits.length > MAX_LISTED) shown.push(`- … 외 ${commits.length - MAX_LISTED}개`);
  return shown;
}

function readRelease(tag) {
  const json = ghApi(`releases/tags/${tag}`, "{published_at, body}");
  if (json === null) return { tag, published: null, highlights: null };
  const { published_at: published, body } = JSON.parse(json);
  const highlights = (body ?? "").split("<details>")[0].trim().split("\n").slice(0, 30).join("\n");
  return { tag, published: published?.slice(0, 10) ?? null, highlights };
}

function readJsonAt(rev, path) {
  const text = git("show", `${rev}:${path}`);
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
function toolchain(rev) {
  const root = readJsonAt(rev, "package.json");
  const desktop = readJsonAt(rev, "apps/desktop/package.json");
  return {
    Node: root?.engines?.node ?? "?",
    pnpm: root?.packageManager?.replace(/^pnpm@/, "") ?? "?",
    Electron: desktop?.dependencies?.electron ?? desktop?.devDependencies?.electron ?? "?",
  };
}

function fixVerdict(fix, related) {
  if (fix.prState === "merged" && fix.inLatest) return "원본 PR이 새 태그에 들어 있음 → 빼기 권장";
  if (fix.issueState === "closed" && fix.issueReason === "completed")
    return "원본 이슈가 해결로 닫힘 → 새 태그에서 증상을 확인하고 빼기 검토";
  if (related > 0) return "관련 원본 변경 있음 → 내용 확인 후 결정";
  return "관련 변경 없음 → 유지";
}

function pickTarget(tags) {
  const base = manifest.upstream.tag;
  if (positional[1]) return positional[1];
  if (args.includes("--nightly")) return tags?.nightly.at(-1) ?? null;
  return tags?.stable.filter((tag) => compareStableTags(tag, base) > 0).at(-1) ?? null;
}

export function review() {
  const base = manifest.upstream.tag;
  const baseCommit = manifest.upstream.commit;
  const tags = readUpstreamTags();
  const target = pickTarget(tags);
  if (!target) {
    console.log(
      tags === null
        ? "원본 태그를 읽지 못했다. 네트워크를 확인하거나 태그를 직접 준다: review v0.1.11"
        : `새 정식 릴리스가 없다 (기준 ${base}). 다음 릴리스에 들어올 내용을 미리 보려면: delta.mjs review --nightly`,
    );
    return;
  }
  const targetCommit = ensureTag(target);
  const range = `${baseCommit}..${targetCommit}`;
  const commitCount = Number(git("rev-list", "--count", range) ?? 0);
  const changedFiles = (git("diff", "--name-only", baseCommit, targetCommit) ?? "")
    .split("\n")
    .filter(Boolean);
  const stableTarget = STABLE_TAG.test(target);
  const releases = (
    stableTarget
      ? (tags?.stable ?? []).filter(
          (t) => compareStableTags(t, base) > 0 && compareStableTags(t, target) <= 0,
        )
      : [target]
  ).map(readRelease);

  const stack = readStack();
  const pending = readPending(stack, target).filter((p) => p.status === "applied");
  const fixes = readHotfixes(stack, target).filter((f) => f.status !== "planned");
  const seams = manifest.seams.filter((s) => s.status === "applied");
  const plugins = readPlugins().filter((p) => p.enabled !== false);
  const fileExists = (file) => git("cat-file", "-e", `${targetCommit}:${file}`) !== null;

  const fixRows = fixes.map((fix) => {
    const files = [...new Set([...(fix.files ?? []), ...(fix.watch ?? [])])];
    const byFile = touching(range, files);
    const byWord = mentioning(range, fix.keywords ?? []);
    const related = [...new Map([...byFile, ...byWord].map((c) => [c.hash, c])).values()];
    return { fix, related, verdict: fixVerdict(fix, related.length) };
  });
  const seamRows = seams.map((seam) => ({
    seam,
    commits: touching(range, [seam.file]),
    exists: fileExists(seam.file),
  }));
  const pluginRows = plugins.map((plugin) => ({
    plugin,
    commits: touching(range, plugin.watch ?? []),
  }));
  const before = toolchain(baseCommit);
  const after = toolchain(targetCommit);

  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `# 원본 업데이트 검토: ${base} → ${target}`,
    "",
    `> ${today} · \`node delta/scripts/delta.mjs review ${target}\`로 만듦 · 원본 커밋 ${commitCount.toLocaleString("en")}개, 바뀐 파일 ${changedFiles.length.toLocaleString("en")}개`,
    ...(stableTarget
      ? []
      : ["", "> 정식 릴리스가 아니다(미리 보기). `sync`는 정식 릴리스 태그로만 한다."]),
    "",
    "## 1. 원본에서 바뀐 것",
    "",
  ];
  for (const release of releases) {
    lines.push(`### ${release.tag}${release.published ? ` (${release.published})` : ""}`, "");
    lines.push(release.highlights ?? "릴리스 노트를 읽지 못했다.", "");
    lines.push(`[전체 변경 목록](${UPSTREAM_URL}/releases/tag/${release.tag})`, "");
  }

  lines.push("## 2. Delta에 미치는 영향", "", "### 직접 수정 (H)", "");
  if (fixRows.length === 0) lines.push("없음", "");
  else {
    lines.push("| ID | 내용 | 원본 이슈 · PR | 관련 원본 커밋 | 판단 |", "|---|---|---|---|---|");
    for (const { fix, related, verdict } of fixRows) {
      const tracking = [
        fix.issue ? `이슈 ${issueLink(fix.issue)} ${fix.issueState ?? "?"}` : null,
        fix.pr ? `PR ${prLink(fix.pr)} ${fix.prState ?? "?"}` : null,
      ].filter(Boolean);
      lines.push(
        `| ${fix.id} | ${cell(fix.title ?? "")} | ${tracking.join(" · ") || "—"} | ${related.length}개 | ${verdict} |`,
      );
    }
    lines.push("");
    for (const { fix, related } of fixRows.filter((row) => row.related.length > 0)) {
      lines.push(`**${fix.id} 관련 원본 커밋**`, "", ...commitList(related), "");
    }
  }

  lines.push("### 임시 패치 (P)", "");
  if (pending.length === 0) lines.push("없음", "");
  else {
    lines.push("| ID | 내용 | 원본 PR | 새 태그에 포함 | 동기화 때 |", "|---|---|---|---|---|");
    for (const patch of pending) {
      const included = patch.inLatest === true ? "예" : patch.inLatest === false ? "아니오" : "?";
      lines.push(
        `| ${patch.id} | ${cell(patch.title ?? "")} | ${prLink(patch.pr)} ${patch.prState ?? "?"} | ${included} | ${patch.inLatest ? "자동으로 빠짐" : "유지"} |`,
      );
    }
    lines.push("");
  }

  lines.push("### 연결 지점 (seam)", "");
  lines.push("| ID | 원본 파일 | 원본 커밋 | 충돌 가능성 |", "|---|---|---|---|");
  for (const { seam, commits, exists } of seamRows) {
    const risk = !exists ? "파일이 없어짐: 새 위치를 찾아야 함" : commits.length ? "있음" : "낮음";
    lines.push(`| ${seam.id} | \`${seam.file}\` | ${commits.length}개 | ${risk} |`);
  }
  lines.push("");
  for (const { seam, commits } of seamRows.filter((row) => row.commits.length > 0)) {
    lines.push(`**${seam.id} 관련 원본 커밋**`, "", ...commitList(commits), "");
  }

  lines.push("### 플러그인", "");
  if (pluginRows.length === 0) lines.push("없음", "");
  else {
    lines.push(
      "| 플러그인 | 의존하는 원본 파일 | 원본 커밋 | 동기화 뒤 할 일 |",
      "|---|---|---|---|",
    );
    for (const { plugin, commits } of pluginRows) {
      const todo = commits.length
        ? "관련 변경 확인, 동작 확인 후 testedUpstream 올리기"
        : "동작 확인 후 testedUpstream 올리기";
      lines.push(
        `| ${plugin.id} | ${(plugin.watch ?? []).map((f) => `\`${f}\``).join("<br>") || "—"} | ${commits.length}개 | ${todo} |`,
      );
    }
    lines.push("");
    for (const { plugin, commits } of pluginRows.filter((row) => row.commits.length > 0)) {
      lines.push(`**${plugin.id} 관련 원본 커밋**`, "", ...commitList(commits), "");
    }
  }

  lines.push("### 빌드 도구", "", `| 항목 | ${base} | ${target} |`, "|---|---|---|");
  for (const key of Object.keys(before)) {
    const changed = before[key] !== after[key] ? " (바뀜)" : "";
    lines.push(`| ${key} | ${before[key]} | ${after[key]}${changed} |`);
  }
  lines.push("", "## 3. 결정할 것", "");
  for (const { fix, verdict } of fixRows) {
    lines.push(
      `- [ ] ${fix.id} ${fix.title ?? ""}: ${verdict}. 빼려면 delta.json에서 \`"status": "retired"\`로 바꾸고 커밋한다`,
    );
  }
  for (const { seam } of seamRows.filter((row) => row.commits.length > 0 || !row.exists)) {
    lines.push(`- [ ] ${seam.id}: 동기화 때 충돌이 나면 LOCAL_PATCHES.md 기준점대로 다시 적용한다`);
  }
  if (stableTarget) {
    lines.push(`- [ ] 동기화: \`node delta/scripts/delta.mjs sync ${target}\``);
  }
  lines.push("");

  const outPath = reviewPath(base, target);
  NodeFS.mkdirSync(NodePath.join(repoRoot, "delta/reviews"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(repoRoot, outPath), lines.join("\n"));

  const summary = [
    `원본 업데이트 검토: ${base} → ${target}${stableTarget ? "" : " (미리 보기)"}`,
    `  원본 커밋 ${commitCount}개, 바뀐 파일 ${changedFiles.length}개, 릴리스 ${releases.map((r) => r.tag).join(", ")}`,
    ...fixRows.map(
      ({ fix, related, verdict }) =>
        `  ${fix.id} ${fix.title ?? ""}: ${verdict} (관련 커밋 ${related.length}개)`,
    ),
    ...pending.map(
      (p) => `  ${p.id} #${p.pr}: ${p.inLatest ? "새 태그에 포함 → 자동으로 빠짐" : "유지"}`,
    ),
    ...seamRows.map(
      ({ seam, commits, exists }) =>
        `  ${seam.id} ${seam.file}: ${exists ? `원본 커밋 ${commits.length}개` : "파일이 없어짐"}`,
    ),
    ...pluginRows.map(
      ({ plugin, commits }) => `  플러그인 ${plugin.id}: 관련 원본 커밋 ${commits.length}개`,
    ),
    `보고서: ${outPath}`,
  ];
  console.log(summary.join("\n"));
}
