import type { DeltaPlugin } from "./types";

// delta/plugins/<id>/plugin.json decides whether a plugin ships; its web part only registers.
const manifests = import.meta.glob<{ readonly id: string; readonly enabled?: boolean }>(
  "../../../../../delta/plugins/*/plugin.json",
  { eager: true, import: "default" },
);
const modules = import.meta.glob<DeltaPlugin>("../plugins/*/index.ts", {
  eager: true,
  import: "default",
});

const enabledIds = new Set(
  Object.values(manifests)
    .filter((manifest) => manifest.enabled !== false)
    .map((manifest) => manifest.id),
);

/** Empty when built with VITE_DELTA_PLUGINS=off, to tell upstream bugs from Delta ones. */
export const deltaPlugins: readonly DeltaPlugin[] =
  import.meta.env.VITE_DELTA_PLUGINS === "off"
    ? []
    : Object.values(modules).filter((plugin) => enabledIds.has(plugin.id));

/** Runs one plugin hook; a throwing plugin logs and yields the fallback so T3 keeps working. */
export function guardPlugin<T>(pluginId: string, hook: string, run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    console.error(`[delta] ${pluginId}.${hook} failed; using upstream behavior`, error);
    return fallback;
  }
}
