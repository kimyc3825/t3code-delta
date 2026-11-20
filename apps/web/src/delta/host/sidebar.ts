// What upstream's Sidebar calls through its Delta seams (S9 to S12). Every entry falls back to
// upstream behavior when no plugin takes part or a plugin throws.
import { useSyncExternalStore, type ReactNode } from "react";

import type { ContextMenuItem, EnvironmentThreadShell, SidebarProjectSnapshot } from "../sdk";
import { sidebarRevision, subscribeSidebarChanges } from "./changes";
import { deltaPlugins, guardPlugin } from "./registry";
import type { DeltaMenuId, ProjectFolderInput, RenderThreadRow } from "./types";

export interface ArrangedProjectFolder {
  readonly deltaView?: { readonly pluginId: string; readonly view: unknown };
}

function arrangeProjectFolder<F extends ProjectFolderInput>(
  folder: F,
  allThreads: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
): F & ArrangedProjectFolder {
  for (const plugin of deltaPlugins) {
    const arrange = plugin.sidebar?.arrangeProjectFolder;
    if (!arrange) continue;
    const result = guardPlugin(
      plugin.id,
      "arrangeProjectFolder",
      () => arrange({ folder, allThreads, routeThreadKey }),
      null,
    );
    if (result) {
      return {
        ...folder,
        threads: result.threads,
        deltaView: { pluginId: plugin.id, view: result.view },
      };
    }
  }
  return folder;
}

/** Upstream's keep-empty rule, also true for project folders a plugin wants kept. */
function keepProjectFolder(
  base: (group: SidebarProjectSnapshot) => boolean,
): (group: SidebarProjectSnapshot) => boolean {
  return (group) =>
    base(group) ||
    deltaPlugins.some((plugin) => {
      const keep = plugin.sidebar?.keepProjectFolder;
      return keep ? guardPlugin(plugin.id, "keepProjectFolder", () => keep(group), false) : false;
    });
}

/** Hook for useSidebarThreads (S9): re-renders on plugin changes and arranges project folders. */
export function useDeltaSidebar() {
  useSyncExternalStore(subscribeSidebarChanges, sidebarRevision);
  return { arrangeProjectFolder, keepProjectFolder };
}

/** Draws a project folder's thread rows (S10). */
export function renderProjectFolderThreads(
  folder: ProjectFolderInput & ArrangedProjectFolder,
  renderThreadRow: RenderThreadRow,
): ReactNode[] {
  const plain = () => folder.threads.map((thread) => renderThreadRow(thread));
  const delta = folder.deltaView;
  const plugin = delta ? deltaPlugins.find((candidate) => candidate.id === delta.pluginId) : null;
  const render = plugin?.sidebar?.renderProjectFolder;
  if (!delta || !plugin || !render) return plain();
  return (
    guardPlugin(
      plugin.id,
      "renderProjectFolder",
      () => render({ folder, view: delta.view, renderThreadRow }),
      null,
    ) ?? plain()
  );
}

export const isDeltaMenuId = (id: string): id is DeltaMenuId => id.startsWith("delta.");

/**
 * Items appended to a thread's (S11) or a selection's (S12) context menu. They take the upstream
 * menu's id type so they concatenate onto it; `isDeltaMenuId` tells their clicks apart before
 * upstream handles one.
 */
export function deltaThreadMenuItems<T extends string = DeltaMenuId>(
  threads: readonly EnvironmentThreadShell[],
  projectGroups: readonly SidebarProjectSnapshot[],
): ContextMenuItem<T>[] {
  const items = deltaPlugins.flatMap((plugin) => {
    const build = plugin.sidebar?.threadMenuItems;
    return build
      ? guardPlugin(plugin.id, "threadMenuItems", () => build({ threads, projectGroups }), [])
      : [];
  });
  const withSeparator = items.map((item, index) =>
    index === 0 ? { ...item, separatorBefore: true } : item,
  );
  return withSeparator as ContextMenuItem<string>[] as ContextMenuItem<T>[];
}

export function handleDeltaThreadMenu(
  id: DeltaMenuId,
  threads: readonly EnvironmentThreadShell[],
  projectGroups: readonly SidebarProjectSnapshot[],
): void {
  for (const plugin of deltaPlugins) {
    const handle = plugin.sidebar?.onThreadMenu;
    if (
      handle &&
      guardPlugin(plugin.id, "onThreadMenu", () => handle({ id, threads, projectGroups }), false)
    ) {
      return;
    }
  }
}
