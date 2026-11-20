import { Component, type ReactNode } from "react";

/** Renders nothing in place of a plugin element that throws, so the sidebar stays up. */
export class DeltaBoundary extends Component<
  { readonly pluginId: string; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(`[delta] ${this.props.pluginId} element failed to render`, error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
