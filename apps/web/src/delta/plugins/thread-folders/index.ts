import { defineDeltaPlugin } from "../../host/types";
import {
  MENU_MOVE,
  MENU_NEW,
  MENU_UNFILE,
  arrangeThreads,
  buildThreadMenu,
  foldersOfProject,
  sharedProjectGroup,
  threadKeyOf,
} from "./logic";
import { renderFolderView } from "./render";
import { useThreadFolders } from "./store";

export default defineDeltaPlugin({
  id: "thread-folders",
  sidebar: {
    // A project keeps showing its folders, even empty ones, when it has no active threads.
    keepProjectFolder: (group) =>
      foldersOfProject(useThreadFolders.getState().folders, group.projectKey).length > 0,
    arrangeProjectFolder: ({ folder, allThreads, routeThreadKey }) => {
      const state = useThreadFolders.getState();
      return arrangeThreads({
        folders: foldersOfProject(state.folders, folder.group.projectKey),
        assignments: state.assignments,
        threads: allThreads,
        projectCollapsed: folder.collapsed,
        routeThreadKey,
      });
    },
    renderProjectFolder: renderFolderView,
    threadMenuItems: ({ threads, projectGroups }) => {
      const state = useThreadFolders.getState();
      return buildThreadMenu({
        threads,
        projectGroups,
        folders: state.folders,
        assignments: state.assignments,
      });
    },
    onThreadMenu: ({ id, threads, projectGroups }) => {
      if (!id.startsWith("delta.thread-folders.")) return false;
      const state = useThreadFolders.getState();
      const keys = threads.map(threadKeyOf);
      if (id === MENU_UNFILE) {
        state.assign(keys, null);
      } else if (id === MENU_NEW) {
        const group = sharedProjectGroup(threads, projectGroups);
        if (group) state.createFolder(group.projectKey, keys);
      } else if (id.startsWith(MENU_MOVE)) {
        state.assign(keys, id.slice(MENU_MOVE.length));
      }
      return true;
    },
  },
});
