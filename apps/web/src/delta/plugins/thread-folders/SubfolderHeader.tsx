import { ChevronDownIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";

import { cn, contextMenuSourceOf, readLocalApi } from "../../sdk";
import type { ThreadFolder } from "./logic";
import { useThreadFolders } from "./store";

/** The folder's sidebar tree row; its thread rows name it as their parent. */
export const subfolderRowId = (folderId: string) => `delta-folder:${folderId}`;

const MENU_RENAME = "rename";
const MENU_UP = "up";
const MENU_DOWN = "down";
const MENU_DELETE = "delete";

function RenameInput(props: { readonly folder: ThreadFolder }) {
  const renameFolder = useThreadFolders((state) => state.renameFolder);
  const setRenaming = useThreadFolders((state) => state.setRenaming);
  const [value, setValue] = useState(props.folder.name);
  const finish = (commit: boolean) => {
    if (commit) renameFolder(props.folder.id, value);
    setRenaming(null);
  };
  return (
    <input
      autoFocus
      aria-label="폴더 이름"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
      className="h-7 w-full rounded-(--control-radius) border border-input bg-background ps-9 pe-2 text-sm text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    />
  );
}

/**
 * A folder inside a project of the grouped sidebar. Click opens or closes it, double-click
 * renames it, and its context menu renames, reorders or deletes it.
 */
export function SubfolderHeader(props: {
  readonly folder: ThreadFolder;
  readonly projectRowId: string;
  readonly total: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const { folder } = props;
  const isRenaming = useThreadFolders((state) => state.renamingFolderId === folder.id);
  const toggleFolder = useThreadFolders((state) => state.toggleFolder);
  const setRenaming = useThreadFolders((state) => state.setRenaming);
  const moveFolder = useThreadFolders((state) => state.moveFolder);
  const deleteFolder = useThreadFolders((state) => state.deleteFolder);
  const Icon = folder.collapsed ? FolderIcon : FolderOpenIcon;

  const openMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const api = readLocalApi();
    if (!api) return;
    const clicked = await api.contextMenu
      .show(
        [
          { id: MENU_RENAME, label: "이름 바꾸기", icon: "pencil" },
          { id: MENU_UP, label: "위로 이동", disabled: props.isFirst, separatorBefore: true },
          { id: MENU_DOWN, label: "아래로 이동", disabled: props.isLast },
          {
            id: MENU_DELETE,
            label: "폴더 삭제",
            detail: "스레드는 프로젝트로 돌아갑니다",
            destructive: true,
            separatorBefore: true,
          },
        ],
        { x: event.clientX, y: event.clientY },
        contextMenuSourceOf(event),
      )
      .catch(() => null);
    if (clicked === MENU_RENAME) setRenaming(folder.id);
    else if (clicked === MENU_UP) moveFolder(folder.id, -1);
    else if (clicked === MENU_DOWN) moveFolder(folder.id, 1);
    else if (clicked === MENU_DELETE) deleteFolder(folder.id);
  };

  return (
    <li data-delta-subfolder={folder.id} className="list-none">
      {isRenaming ? (
        <RenameInput folder={folder} />
      ) : (
        <button
          type="button"
          data-sidebar-row={subfolderRowId(folder.id)}
          data-sidebar-parent={props.projectRowId}
          aria-expanded={!folder.collapsed}
          onClick={() => toggleFolder(folder.id)}
          onDoubleClick={() => setRenaming(folder.id)}
          onContextMenu={(event) => void openMenu(event)}
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-(--control-radius) ps-9 pe-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Icon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground/85">
            {folder.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {props.total}
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
              folder.collapsed && "-rotate-90",
            )}
          />
        </button>
      )}
    </li>
  );
}
