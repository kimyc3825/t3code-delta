import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type LocalApi,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../../test/render";
import Sidebar from "../../../components/Sidebar";
import { SidebarProvider } from "../../../components/ui/sidebar";
import { useHandleNewThread } from "../../../hooks/useHandleNewThread";
import { useNowMinute } from "../../../hooks/useNowMinute";
import { __setClientSettingsForTests, getClientSettings } from "../../../hooks/useSettings";
import { useThreadRouteTarget } from "../../../hooks/useThreadRouteTarget";
import { readLocalApi } from "../../../localApi";
import { useProjects, useQuietThreadShells } from "../../../state/entities";
import { makeThreadFixture } from "../../../test-fixtures";
import type { Project } from "../../../types";
import { MENU_MOVE, MENU_ROOT, threadKeyOf } from "./logic";
import { useThreadFolders } from "./store";

vi.mock("../../../state/entities", { spy: true });
vi.mock("../../../hooks/useHandleNewThread", { spy: true });
vi.mock("../../../hooks/useNowMinute", { spy: true });
vi.mock("../../../hooks/useThreadRouteTarget", { spy: true });
vi.mock("../../../localApi", { spy: true });
vi.mock("../../../components/sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const environmentId = EnvironmentId.make("local");
const project: Project = {
  id: ProjectId.make("alpha"),
  environmentId,
  title: "alpha",
  workspaceRoot: "/projects/alpha",
  repositoryIdentity: null,
  defaultModelSelection: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scripts: [],
};
const threads: EnvironmentThreadShell[] = [0, 1, 2].map((index) =>
  makeThreadFixture({
    environmentId,
    id: ThreadId.make(`thread-${index}`),
    projectId: project.id,
    title: `Thread ${index}`,
  }),
);

async function renderGroupedSidebar() {
  const previousSettings = getClientSettings();
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, boringSidebarEnabled: true });
  // The open thread stays unfiled, so closing a folder hides all of its rows.
  const routeThreadRef = { environmentId, threadId: threads[2]!.id };
  vi.mocked(useNowMinute).mockReturnValue("2026-01-01T00:00");
  vi.mocked(useProjects).mockReturnValue([project]);
  vi.mocked(useQuietThreadShells).mockReturnValue(threads);
  vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: routeThreadRef });
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: { environmentId, projectId: project.id },
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn().mockResolvedValue(null),
    routeDraftId: null,
    routeThreadRef,
  });
  const screen = await render(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect.element(screen.getByText("Thread 0").first()).toBeInTheDocument();
  const projectRow = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-project-folder"] [data-sidebar-row]',
  );
  const projectKey = projectRow!.dataset.sidebarRow!.slice("folder:".length);
  return {
    screen,
    projectKey,
    [Symbol.asyncDispose]: async () => {
      await screen[Symbol.asyncDispose]();
      __setClientSettingsForTests(previousSettings);
    },
  };
}

const fileIntoFolder = (projectKey: string, filed: readonly EnvironmentThreadShell[]) =>
  act(() =>
    useThreadFolders.setState({
      folders: { f1: { id: "f1", projectKey, name: "설계", collapsed: false, order: 0 } },
      assignments: Object.fromEntries(filed.map((thread) => [threadKeyOf(thread), "f1"])),
      renamingFolderId: null,
    }),
  );

/** Clears folders when the test that filed threads ends. */
const foldersCleared = (): Disposable => ({
  [Symbol.dispose]: () =>
    useThreadFolders.setState({ folders: {}, assignments: {}, renamingFolderId: null }),
});

describe("thread folders in the grouped sidebar", () => {
  it("draws a folder with its threads one level in, and closing it hides them", async () => {
    using _folders = foldersCleared();
    await using rendered = await renderGroupedSidebar();
    const { screen } = rendered;
    await fileIntoFolder(rendered.projectKey, [threads[0]!, threads[1]!]);

    const header = screen.getByRole("button", { name: /설계/ });
    await expect.element(header).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(header)
      .toHaveAttribute("data-sidebar-parent", `folder:${rendered.projectKey}`);
    const body = () => screen.container.querySelector('[data-delta-subfolder-body="f1"]');
    await vi.waitFor(() => expect(body()?.textContent).toContain("Thread 0"));
    expect(body()?.textContent).toContain("Thread 1");
    expect(body()?.textContent).not.toContain("Thread 2");

    await userEvent.click(header);
    await expect.element(header).toHaveAttribute("aria-expanded", "false");
    expect(body()).toBeNull();
    await expect.element(screen.getByText("Thread 0")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Thread 2").first()).toBeInTheDocument();
  });

  it("moves a thread into a folder from its context menu", async () => {
    const show = vi.fn().mockResolvedValue(`${MENU_MOVE}f1`);
    vi.mocked(readLocalApi).mockReturnValue({ contextMenu: { show } } as unknown as LocalApi);
    using _folders = foldersCleared();
    await using rendered = await renderGroupedSidebar();
    const { screen } = rendered;
    await fileIntoFolder(rendered.projectKey, [threads[0]!]);

    await userEvent.click(screen.getByText("Thread 2").first(), { button: "right" });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    const items = show.mock.lastCall![0] as Array<{ id: string; children?: Array<{ id: string }> }>;
    const root = items.find((item) => item.id === MENU_ROOT);
    expect(root?.children?.map((item) => item.id)).toContain(`${MENU_MOVE}f1`);

    await vi.waitFor(() =>
      expect(
        screen.container.querySelector('[data-delta-subfolder-body="f1"]')?.textContent,
      ).toContain("Thread 2"),
    );
    expect(useThreadFolders.getState().assignments[threadKeyOf(threads[2]!)]).toBe("f1");
  });
  it("keeps a project with folders on screen after its last active thread leaves", async () => {
    using _folders = foldersCleared();
    await using rendered = await renderGroupedSidebar();
    const { screen } = rendered;
    vi.mocked(useQuietThreadShells).mockReturnValue([]);
    await act(() =>
      useThreadFolders.setState({
        folders: {
          f1: {
            id: "f1",
            projectKey: rendered.projectKey,
            name: "설계",
            collapsed: false,
            order: 0,
          },
        },
        assignments: {},
        renamingFolderId: null,
      }),
    );

    await expect.element(screen.getByText("Thread 0")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: /설계/ })).toBeInTheDocument();
    await expect.element(screen.getByText(/비어 있음/)).toBeInTheDocument();
  });
});
