import { create } from "zustand";

import { notifySidebarChanged } from "../../host/changes";
import { foldersOfProject, uniqueFolderName, type ThreadFolder } from "./logic";

// Folders live in this app's local storage: T3 servers do not know about them.
const STORAGE_KEY = "delta.thread-folders.v1";

interface Persisted {
  readonly folders: Record<string, ThreadFolder>;
  readonly assignments: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFolder = (value: unknown): value is ThreadFolder =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.projectKey === "string" &&
  typeof value.name === "string" &&
  typeof value.collapsed === "boolean" &&
  typeof value.order === "number";

export function parsePersisted(raw: string | null): Persisted {
  const empty = { folders: {}, assignments: {} };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.folders) || !isRecord(parsed.assignments))
      return empty;
    const folders = Object.fromEntries(
      Object.entries(parsed.folders).filter(([id, folder]) => isFolder(folder) && folder.id === id),
    ) as Record<string, ThreadFolder>;
    const assignments = Object.fromEntries(
      Object.entries(parsed.assignments).filter(
        ([, folderId]) => typeof folderId === "string" && folderId in folders,
      ),
    ) as Record<string, string>;
    return { folders, assignments };
  } catch {
    return empty;
  }
}

function readStorage(): Persisted {
  try {
    return parsePersisted(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parsePersisted(null);
  }
}

function writeStorage(state: Persisted): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, folders: state.folders, assignments: state.assignments }),
    );
  } catch {
    // Storage can be full or blocked; folders then last until the app closes.
  }
}

// Ids only need to be unique within this app's storage.
const newFolderId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface ThreadFoldersState extends Persisted {
  readonly renamingFolderId: string | null;
  /** Creates a folder at the end of the project, files the threads into it, and starts renaming. */
  readonly createFolder: (projectKey: string, threadKeys: readonly string[]) => string;
  readonly renameFolder: (folderId: string, name: string) => void;
  readonly toggleFolder: (folderId: string) => void;
  readonly moveFolder: (folderId: string, direction: -1 | 1) => void;
  /** Deletes the folder; its threads go back to the project. */
  readonly deleteFolder: (folderId: string) => void;
  /** Files threads into a folder (opening it), or takes them out with null. */
  readonly assign: (threadKeys: readonly string[], folderId: string | null) => void;
  readonly setRenaming: (folderId: string | null) => void;
}

export const useThreadFolders = create<ThreadFoldersState>()((set, get) => ({
  ...readStorage(),
  renamingFolderId: null,
  createFolder: (projectKey, threadKeys) => {
    const siblings = foldersOfProject(get().folders, projectKey);
    const folder: ThreadFolder = {
      id: newFolderId(),
      projectKey,
      name: uniqueFolderName(siblings.map((sibling) => sibling.name)),
      collapsed: false,
      order: Math.max(0, ...siblings.map((sibling) => sibling.order + 1)),
    };
    set((state) => ({
      folders: { ...state.folders, [folder.id]: folder },
      assignments: {
        ...state.assignments,
        ...Object.fromEntries(threadKeys.map((key) => [key, folder.id])),
      },
      renamingFolderId: folder.id,
    }));
    return folder.id;
  },
  renameFolder: (folderId, name) => {
    const trimmed = name.trim();
    const folder = get().folders[folderId];
    if (!folder || trimmed.length === 0 || trimmed === folder.name) return;
    set((state) => ({ folders: { ...state.folders, [folderId]: { ...folder, name: trimmed } } }));
  },
  toggleFolder: (folderId) => {
    const folder = get().folders[folderId];
    if (!folder) return;
    set((state) => ({
      folders: { ...state.folders, [folderId]: { ...folder, collapsed: !folder.collapsed } },
    }));
  },
  moveFolder: (folderId, direction) => {
    const folder = get().folders[folderId];
    if (!folder) return;
    const siblings = foldersOfProject(get().folders, folder.projectKey);
    const index = siblings.findIndex((sibling) => sibling.id === folderId);
    const other = siblings[index + direction];
    if (!other) return;
    // Renumber so equal orders from older data cannot make the swap a no-op.
    const reordered = siblings.map((sibling, position) => ({ ...sibling, order: position }));
    const a = reordered[index]!;
    const b = reordered[index + direction]!;
    reordered[index] = { ...b, order: a.order };
    reordered[index + direction] = { ...a, order: b.order };
    set((state) => ({
      folders: { ...state.folders, ...Object.fromEntries(reordered.map((f) => [f.id, f])) },
    }));
  },
  deleteFolder: (folderId) => {
    set((state) => {
      const { [folderId]: _removed, ...folders } = state.folders;
      const assignments = Object.fromEntries(
        Object.entries(state.assignments).filter(([, id]) => id !== folderId),
      );
      return {
        folders,
        assignments,
        renamingFolderId: state.renamingFolderId === folderId ? null : state.renamingFolderId,
      };
    });
  },
  assign: (threadKeys, folderId) => {
    set((state) => {
      const assignments = { ...state.assignments };
      for (const key of threadKeys) {
        if (folderId === null) delete assignments[key];
        else assignments[key] = folderId;
      }
      const folder = folderId ? state.folders[folderId] : undefined;
      const folders =
        folder && folder.collapsed
          ? { ...state.folders, [folder.id]: { ...folder, collapsed: false } }
          : state.folders;
      return { assignments, folders };
    });
  },
  setRenaming: (folderId) => set({ renamingFolderId: folderId }),
}));

useThreadFolders.subscribe((state, previous) => {
  if (state.folders === previous.folders && state.assignments === previous.assignments) return;
  writeStorage(state);
  notifySidebarChanged();
});
