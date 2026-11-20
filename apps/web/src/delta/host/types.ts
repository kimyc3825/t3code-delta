import type { ReactNode } from "react";

import type { ContextMenuItem, EnvironmentThreadShell, SidebarProjectSnapshot } from "../sdk";

/** Context menu ids that belong to Delta plugins: `delta.<plugin id>.<command>`. */
export type DeltaMenuId = `delta.${string}`;

/** A project folder of the grouped sidebar, as upstream builds it. */
export interface ProjectFolderInput {
  readonly group: SidebarProjectSnapshot;
  readonly collapsed: boolean;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly hiddenThreads: readonly EnvironmentThreadShell[];
}

/** Renders one upstream thread row; `parentRow` is its tree parent for keyboard navigation. */
export type RenderThreadRow = (thread: EnvironmentThreadShell, parentRow?: string) => ReactNode;

export interface SidebarExtension {
  /** Keeps a project folder on screen while it has no active threads. */
  readonly keepProjectFolder?: (group: SidebarProjectSnapshot) => boolean;
  /**
   * Reorders and filters a project folder's threads, before upstream derives selection order
   * from them. `allThreads` includes the threads a closed project folder hides.
   */
  readonly arrangeProjectFolder?: (input: {
    readonly folder: ProjectFolderInput;
    readonly allThreads: readonly EnvironmentThreadShell[];
    readonly routeThreadKey: string | null;
  }) => { readonly threads: readonly EnvironmentThreadShell[]; readonly view: unknown } | null;
  /** Draws a project folder's threads from the view `arrangeProjectFolder` returned. */
  readonly renderProjectFolder?: (input: {
    readonly folder: ProjectFolderInput;
    readonly view: unknown;
    readonly renderThreadRow: RenderThreadRow;
  }) => ReactNode[];
  /** Items appended to the context menu of one or more selected threads. */
  readonly threadMenuItems?: (input: {
    readonly threads: readonly EnvironmentThreadShell[];
    readonly projectGroups: readonly SidebarProjectSnapshot[];
  }) => ContextMenuItem<DeltaMenuId>[];
  readonly onThreadMenu?: (input: {
    readonly id: DeltaMenuId;
    readonly threads: readonly EnvironmentThreadShell[];
    readonly projectGroups: readonly SidebarProjectSnapshot[];
  }) => boolean;
}

export interface DeltaPlugin {
  /** Matches the folder name in delta/plugins/<id>. */
  readonly id: string;
  readonly sidebar?: SidebarExtension;
}

export const defineDeltaPlugin = (plugin: DeltaPlugin): DeltaPlugin => plugin;
