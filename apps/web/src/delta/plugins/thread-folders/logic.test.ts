import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell, SidebarProjectSnapshot } from "../../sdk";
import { makeThreadFixture } from "../../../test-fixtures";
import {
  MENU_MOVE,
  MENU_NEW,
  MENU_ROOT,
  MENU_UNFILE,
  arrangeThreads,
  buildThreadMenu,
  foldersOfProject,
  threadKeyOf,
  uniqueFolderName,
  type ThreadFolder,
} from "./logic";

const env = EnvironmentId.make("local");
const thread = (id: string, projectId = "alpha"): EnvironmentThreadShell =>
  makeThreadFixture({
    environmentId: env,
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    title: id,
  });
const folder = (id: string, order: number, extra: Partial<ThreadFolder> = {}): ThreadFolder => ({
  id,
  projectKey: "alpha-key",
  name: id,
  collapsed: false,
  order,
  ...extra,
});
const group = (projectKey: string, projectId: string) =>
  ({
    projectKey,
    displayName: projectKey,
    memberProjectRefs: [{ environmentId: env, projectId: ProjectId.make(projectId) }],
  }) as unknown as SidebarProjectSnapshot;
const titles = (threads: readonly EnvironmentThreadShell[]) => threads.map((t) => t.title);

describe("arrangeThreads", () => {
  const threads = [thread("t1"), thread("t2"), thread("t3"), thread("t4")];

  it("leaves a project without folders, or a closed project, to upstream", () => {
    const base = { assignments: {}, threads, routeThreadKey: null };
    expect(arrangeThreads({ ...base, folders: [], projectCollapsed: false })).toBeNull();
    expect(
      arrangeThreads({ ...base, folders: [folder("a", 0)], projectCollapsed: true }),
    ).toBeNull();
  });

  it("puts folders first in their order, keeps upstream order inside, then unfiled threads", () => {
    const result = arrangeThreads({
      folders: [folder("a", 0), folder("b", 1)],
      assignments: {
        [threadKeyOf(threads[3]!)]: "a",
        [threadKeyOf(threads[0]!)]: "b",
        [threadKeyOf(threads[1]!)]: "a",
      },
      threads,
      projectCollapsed: false,
      routeThreadKey: null,
    })!;
    expect(result.view.subfolders.map((s) => [s.folder.id, titles(s.threads), s.total])).toEqual([
      ["a", ["t2", "t4"], 2],
      ["b", ["t1"], 1],
    ]);
    expect(titles(result.view.loose)).toEqual(["t3"]);
    expect(titles(result.threads)).toEqual(["t2", "t4", "t1", "t3"]);
  });

  it("hides a closed folder's threads except the open one", () => {
    const result = arrangeThreads({
      folders: [folder("a", 0, { collapsed: true })],
      assignments: { [threadKeyOf(threads[0]!)]: "a", [threadKeyOf(threads[1]!)]: "a" },
      threads,
      projectCollapsed: false,
      routeThreadKey: threadKeyOf(threads[1]!),
    })!;
    expect(titles(result.view.subfolders[0]!.threads)).toEqual(["t2"]);
    expect(result.view.subfolders[0]!.total).toBe(2);
    expect(titles(result.threads)).toEqual(["t2", "t3", "t4"]);
  });

  it("treats a thread filed under another project's folder as unfiled", () => {
    const result = arrangeThreads({
      folders: [folder("a", 0)],
      assignments: { [threadKeyOf(threads[0]!)]: "elsewhere" },
      threads,
      projectCollapsed: false,
      routeThreadKey: null,
    })!;
    expect(titles(result.view.loose)).toEqual(["t1", "t2", "t3", "t4"]);
  });
});

describe("buildThreadMenu", () => {
  const groups = [group("alpha-key", "alpha"), group("beta-key", "beta")];
  const folders = {
    a: folder("a", 0),
    b: folder("b", 1),
    c: folder("c", 0, { projectKey: "beta-key" }),
  };

  it("offers the project's folders, a new folder, and unfiling for filed threads", () => {
    const t1 = thread("t1");
    const [root] = buildThreadMenu({
      threads: [t1],
      projectGroups: groups,
      folders,
      assignments: { [threadKeyOf(t1)]: "b" },
    });
    expect(root?.id).toBe(MENU_ROOT);
    expect(root?.children?.map((item) => [item.id, item.checked ?? null])).toEqual([
      [`${MENU_MOVE}a`, false],
      [`${MENU_MOVE}b`, true],
      [MENU_NEW, null],
      [MENU_UNFILE, null],
    ]);
  });

  it("counts a selection and leaves out unfiling when nothing is filed", () => {
    const [root] = buildThreadMenu({
      threads: [thread("t1"), thread("t2")],
      projectGroups: groups,
      folders,
      assignments: {},
    });
    expect(root?.label).toBe("폴더로 이동 (2)");
    expect(root?.children?.some((item) => item.id === MENU_UNFILE)).toBe(false);
  });

  it("disables moving a selection that spans projects, and skips threads with no project", () => {
    const [mixed] = buildThreadMenu({
      threads: [thread("t1"), thread("t2", "beta")],
      projectGroups: groups,
      folders,
      assignments: {},
    });
    expect(mixed?.disabled).toBe(true);
    expect(
      buildThreadMenu({
        threads: [thread("t9", "none")],
        projectGroups: groups,
        folders,
        assignments: {},
      }),
    ).toEqual([]);
  });
});

describe("folder names and order", () => {
  it("numbers new folder names past the taken ones", () => {
    expect(uniqueFolderName([])).toBe("새 폴더");
    expect(uniqueFolderName(["새 폴더", "새 폴더 2"])).toBe("새 폴더 3");
  });

  it("lists a project's folders by order, then name", () => {
    const folders = { x: folder("x", 1), y: folder("y", 0), z: folder("w", 1, { id: "z" }) };
    expect(foldersOfProject(folders, "alpha-key").map((f) => f.id)).toEqual(["y", "z", "x"]);
  });
});
