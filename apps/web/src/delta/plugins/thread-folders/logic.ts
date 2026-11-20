import type { DeltaMenuId } from "../../host/types";
import {
  scopedThreadKey,
  scopeThreadRef,
  type ContextMenuItem,
  type EnvironmentThreadShell,
  type SidebarProjectSnapshot,
} from "../../sdk";

/** A folder inside one project of the grouped sidebar. It exists only in T3 Code - Delta. */
export interface ThreadFolder {
  readonly id: string;
  readonly projectKey: string;
  readonly name: string;
  readonly collapsed: boolean;
  readonly order: number;
}

export interface SubfolderView {
  readonly folder: ThreadFolder;
  /** The rows to draw: all members, or only the open thread while the folder is closed. */
  readonly threads: readonly EnvironmentThreadShell[];
  readonly total: number;
}

export interface FolderView {
  readonly subfolders: readonly SubfolderView[];
  readonly loose: readonly EnvironmentThreadShell[];
}

export const MENU_ROOT: DeltaMenuId = "delta.thread-folders.menu";
export const MENU_MOVE = "delta.thread-folders.move:";
export const MENU_NEW: DeltaMenuId = "delta.thread-folders.new";
export const MENU_UNFILE: DeltaMenuId = "delta.thread-folders.unfile";
const DEFAULT_FOLDER_NAME = "새 폴더";

export const threadKeyOf = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export function foldersOfProject(
  folders: Readonly<Record<string, ThreadFolder>>,
  projectKey: string,
): ThreadFolder[] {
  return Object.values(folders)
    .filter((folder) => folder.projectKey === projectKey)
    .toSorted((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Splits a project's threads into its folders, keeping upstream's order inside each. Folders come
 * first, then the threads in no folder. Null leaves the project as upstream draws it.
 */
export function arrangeThreads(input: {
  readonly folders: readonly ThreadFolder[];
  readonly assignments: Readonly<Record<string, string>>;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projectCollapsed: boolean;
  readonly routeThreadKey: string | null;
}): { readonly threads: EnvironmentThreadShell[]; readonly view: FolderView } | null {
  if (input.projectCollapsed || input.folders.length === 0) return null;
  const folderIds = new Set(input.folders.map((folder) => folder.id));
  const members = new Map<string, EnvironmentThreadShell[]>();
  const loose: EnvironmentThreadShell[] = [];
  for (const thread of input.threads) {
    const folderId = input.assignments[threadKeyOf(thread)];
    if (folderId !== undefined && folderIds.has(folderId)) {
      const list = members.get(folderId);
      if (list) list.push(thread);
      else members.set(folderId, [thread]);
    } else {
      loose.push(thread);
    }
  }
  const subfolders = input.folders.map((folder) => {
    const all = members.get(folder.id) ?? [];
    const threads = folder.collapsed
      ? all.filter((thread) => threadKeyOf(thread) === input.routeThreadKey)
      : all;
    return { folder, threads, total: all.length };
  });
  return {
    threads: [...subfolders.flatMap((subfolder) => subfolder.threads), ...loose],
    view: { subfolders, loose },
  };
}

function projectGroupOf(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
  projectGroups: readonly SidebarProjectSnapshot[],
): SidebarProjectSnapshot | null {
  return (
    projectGroups.find((group) =>
      group.memberProjectRefs.some(
        (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
      ),
    ) ?? null
  );
}

/** The one project all threads belong to, or null when they span projects or have none. */
export function sharedProjectGroup(
  threads: readonly EnvironmentThreadShell[],
  projectGroups: readonly SidebarProjectSnapshot[],
): SidebarProjectSnapshot | null {
  let shared: SidebarProjectSnapshot | null = null;
  for (const thread of threads) {
    const group = projectGroupOf(thread, projectGroups);
    if (!group || (shared && shared.projectKey !== group.projectKey)) return null;
    shared = group;
  }
  return shared;
}

export function buildThreadMenu(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projectGroups: readonly SidebarProjectSnapshot[];
  readonly folders: Readonly<Record<string, ThreadFolder>>;
  readonly assignments: Readonly<Record<string, string>>;
}): ContextMenuItem<DeltaMenuId>[] {
  if (input.threads.length === 0) return [];
  const label = input.threads.length > 1 ? `폴더로 이동 (${input.threads.length})` : "폴더로 이동";
  const group = sharedProjectGroup(input.threads, input.projectGroups);
  if (!group) {
    const anyProject = input.threads.some((thread) => projectGroupOf(thread, input.projectGroups));
    return anyProject
      ? [{ id: MENU_ROOT, label, icon: "folder", detail: "한 프로젝트의 스레드만", disabled: true }]
      : [];
  }
  const folders = foldersOfProject(input.folders, group.projectKey);
  const assigned = input.threads.map((thread) => {
    const folderId = input.assignments[threadKeyOf(thread)];
    return folderId !== undefined && folders.some((folder) => folder.id === folderId)
      ? folderId
      : null;
  });
  const children: ContextMenuItem<DeltaMenuId>[] = [
    ...folders.map((folder): ContextMenuItem<DeltaMenuId> => ({
      id: `${MENU_MOVE}${folder.id}`,
      label: folder.name,
      checked: assigned.every((folderId) => folderId === folder.id),
    })),
    { id: MENU_NEW, label: "새 폴더 만들기", separatorBefore: folders.length > 0 },
    ...(assigned.some((folderId) => folderId !== null)
      ? [{ id: MENU_UNFILE, label: "폴더에서 빼기", separatorBefore: true } as const]
      : []),
  ];
  return [{ id: MENU_ROOT, label, icon: "folder", children }];
}

/** "새 폴더", then "새 폴더 2", "새 폴더 3", … among the project's folder names. */
export function uniqueFolderName(existing: readonly string[], base = DEFAULT_FOLDER_NAME): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}
