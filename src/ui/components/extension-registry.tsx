import type { ActivePanel, PanelContext } from '../extension-slots.ts'

/** A panel contributed by an extension. */
export type ExtensionPanel = {
  id: string
  component: React.ComponentType<PanelContext>
  title: string
}

/** Module-level registry of panels contributed by extensions. Populated by the host importing
 * each extension's frontend entry, which calls `registerPanel`. */
const panels = new Map<string, ExtensionPanel>()

/** Registers a panel contributed by an extension. Called by an extension's frontend entry. */
export function registerPanel(panelId: string, component: React.ComponentType<PanelContext>, title: string): void {
  panels.set(panelId, { id: panelId, component, title })
}

/** Returns all registered panels. */
export function getPanels(): ExtensionPanel[] {
  return Array.from(panels.values())
}

/** Clears all registered panels. For tests only. */
export function clearPanelsForTesting(): void {
  panels.clear()
}

/** Renders the active extension panel in the main area. The panel gets its params and navigation from the host and
 * draws its own header, tabs and status. Nothing is rendered when no panel is active or the panel is not registered. */
export function ExtensionRegistry({ panel, context }: { panel: ActivePanel | null; context: PanelContext }) {
  const registered = panel !== null ? panels.get(panel.id) ?? null : null
  if (registered === null) {
    return null
  }
  const Component = registered.component
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Component {...context} />
    </div>
  )
}
