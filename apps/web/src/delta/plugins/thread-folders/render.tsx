import type { ReactNode } from "react";

import { DeltaBoundary } from "../../host/DeltaBoundary";
import type { ProjectFolderInput, RenderThreadRow } from "../../host/types";
import { sidebarFolderRowId } from "../../sdk";
import type { FolderView } from "./logic";
import { SubfolderHeader, subfolderRowId } from "./SubfolderHeader";
import { useThreadFolders } from "./store";

const PLUGIN_ID = "thread-folders";

/** Under an open folder with no active rows: empty, or its threads sit in other sections. */
function EmptyFolderHint(props: { readonly folderId: string }) {
  const filedElsewhere = useThreadFolders((state) =>
    Object.values(state.assignments).some((folderId) => folderId === props.folderId),
  );
  return (
    <li className="list-none py-1 ps-14 text-xs text-sidebar-muted-foreground">
      {filedElsewhere
        ? "Active 스레드 없음 · 나머지는 아래 구역에 있음"
        : "비어 있음 · 스레드를 오른쪽 클릭해 “폴더로 이동”"}
    </li>
  );
}

/** Folders first (header, then its rows one level in), then the project's unfiled threads. */
export function renderFolderView(input: {
  readonly folder: ProjectFolderInput;
  readonly view: unknown;
  readonly renderThreadRow: RenderThreadRow;
}): ReactNode[] {
  const view = input.view as FolderView;
  const projectRowId = sidebarFolderRowId(input.folder.group.projectKey);
  const nodes: ReactNode[] = [];
  view.subfolders.forEach((subfolder, index) => {
    const { folder } = subfolder;
    nodes.push(
      <DeltaBoundary key={`delta-subfolder:${folder.id}`} pluginId={PLUGIN_ID}>
        <SubfolderHeader
          folder={folder}
          projectRowId={projectRowId}
          total={subfolder.total}
          isFirst={index === 0}
          isLast={index === view.subfolders.length - 1}
        />
      </DeltaBoundary>,
    );
    if (subfolder.threads.length > 0) {
      const rowId = subfolderRowId(folder.id);
      nodes.push(
        <li
          key={`delta-subfolder-body:${folder.id}`}
          data-delta-subfolder-body={folder.id}
          className="list-none"
        >
          <ul className="ms-4 border-s border-sidebar-border/70">
            {subfolder.threads.map((thread) => input.renderThreadRow(thread, rowId))}
          </ul>
        </li>,
      );
    } else if (!folder.collapsed && subfolder.total === 0) {
      nodes.push(
        <DeltaBoundary key={`delta-subfolder-empty:${folder.id}`} pluginId={PLUGIN_ID}>
          <EmptyFolderHint folderId={folder.id} />
        </DeltaBoundary>,
      );
    }
  });
  for (const thread of view.loose) nodes.push(input.renderThreadRow(thread));
  return nodes;
}
