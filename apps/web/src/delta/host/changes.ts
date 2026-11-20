// A revision counter plugins bump when state that shapes upstream screens changes. No imports,
// so plugin stores can use it without an import cycle through the registry.
let revision = 0;
const listeners = new Set<() => void>();

export function notifySidebarChanged(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export const subscribeSidebarChanges = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const sidebarRevision = () => revision;
