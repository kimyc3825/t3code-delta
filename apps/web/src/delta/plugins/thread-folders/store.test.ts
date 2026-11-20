import { beforeEach, describe, expect, it } from "vite-plus/test";

import { foldersOfProject } from "./logic";
import { parsePersisted, useThreadFolders } from "./store";

const reset = () =>
  useThreadFolders.setState({ folders: {}, assignments: {}, renamingFolderId: null });

describe("parsePersisted", () => {
  it("drops malformed folders and assignments to missing folders", () => {
    const raw = JSON.stringify({
      version: 1,
      folders: {
        a: { id: "a", projectKey: "p", name: "A", collapsed: false, order: 0 },
        b: { id: "not-b", projectKey: "p", name: "B", collapsed: false, order: 1 },
        c: { id: "c", name: "no project" },
      },
      assignments: { t1: "a", t2: "b", t3: 7 },
    });
    expect(parsePersisted(raw)).toEqual({
      folders: { a: { id: "a", projectKey: "p", name: "A", collapsed: false, order: 0 } },
      assignments: { t1: "a" },
    });
    expect(parsePersisted("not json")).toEqual({ folders: {}, assignments: {} });
    expect(parsePersisted(null)).toEqual({ folders: {}, assignments: {} });
  });
});

describe("thread folder store", () => {
  beforeEach(reset);

  it("creates a named folder at the end, files threads into it, and starts renaming", () => {
    const store = useThreadFolders.getState();
    const first = store.createFolder("p", ["t1"]);
    const second = useThreadFolders.getState().createFolder("p", ["t2", "t3"]);
    const state = useThreadFolders.getState();
    expect(foldersOfProject(state.folders, "p").map((f) => [f.name, f.order])).toEqual([
      ["새 폴더", 0],
      ["새 폴더 2", 1],
    ]);
    expect(state.assignments).toEqual({ t1: first, t2: second, t3: second });
    expect(state.renamingFolderId).toBe(second);
  });

  it("renames with trimming and ignores blank names", () => {
    const id = useThreadFolders.getState().createFolder("p", []);
    useThreadFolders.getState().renameFolder(id, "  설계  ");
    useThreadFolders.getState().renameFolder(id, "   ");
    expect(useThreadFolders.getState().folders[id]?.name).toBe("설계");
  });

  it("opens a closed folder when threads are filed into it, and unfiles with null", () => {
    const id = useThreadFolders.getState().createFolder("p", []);
    useThreadFolders.getState().toggleFolder(id);
    expect(useThreadFolders.getState().folders[id]?.collapsed).toBe(true);
    useThreadFolders.getState().assign(["t1", "t2"], id);
    expect(useThreadFolders.getState().folders[id]?.collapsed).toBe(false);
    useThreadFolders.getState().assign(["t1"], null);
    expect(useThreadFolders.getState().assignments).toEqual({ t2: id });
  });

  it("swaps a folder with its neighbor and stops at the ends", () => {
    const a = useThreadFolders.getState().createFolder("p", []);
    const b = useThreadFolders.getState().createFolder("p", []);
    useThreadFolders.getState().moveFolder(b, -1);
    expect(foldersOfProject(useThreadFolders.getState().folders, "p").map((f) => f.id)).toEqual([
      b,
      a,
    ]);
    useThreadFolders.getState().moveFolder(b, -1);
    expect(foldersOfProject(useThreadFolders.getState().folders, "p").map((f) => f.id)).toEqual([
      b,
      a,
    ]);
  });

  it("deletes a folder and returns its threads to the project", () => {
    const a = useThreadFolders.getState().createFolder("p", ["t1"]);
    const b = useThreadFolders.getState().createFolder("p", ["t2"]);
    useThreadFolders.getState().deleteFolder(a);
    const state = useThreadFolders.getState();
    expect(Object.keys(state.folders)).toEqual([b]);
    expect(state.assignments).toEqual({ t2: b });
  });
});
