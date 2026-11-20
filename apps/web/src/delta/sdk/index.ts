// The only door from Delta plugins into upstream web code. When upstream renames or moves one of
// these, fix it here and the plugins keep compiling.
export type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
export { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
export type { ContextMenuItem, ContextMenuSource } from "@t3tools/contracts";
export type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
export { sidebarFolderRowId } from "~/components/sidebar/SidebarProjectFolderHeader";
export { contextMenuSourceOf } from "~/contextMenuSource";
export { readLocalApi } from "~/localApi";
export { cn } from "~/lib/utils";
