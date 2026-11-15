import type { ReactNode } from 'react'

/** A panel contributed by an extension. */
export type ExtensionPanel = {
  id: string
  component: React.ComponentType
  title: string
}

/** Module-level registry of panels contributed by extensions. Populated by the host importing
 * each extension's frontend entry, which calls `registerPanel`. */
const panels = new Map<string, ExtensionPanel>()

/** Registers a panel contributed by an extension. Called by an extension's frontend entry. */
export function registerPanel(panelId: string, component: React.ComponentType, title: string): void {
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

/** Renders contributed extension panels as tabs in the main area. The host supplies the active panel
 * and an onClose callback; this component only renders the active panel's component inside a layout
 * container. The terminal panel provides its own header, tab bar, and status bar.
 */
export function ExtensionRegistry({ activePanelId, onClose }: {
  activePanelId: string | null
  onClose(panelId: string): void
}) {
  const panel = activePanelId !== null ? panels.get(activePanelId) ?? null : null
  return (
    <div className="min-w-0 flex-1 flex-col">
      {panel !== null ? <panel.component /> : null}
    </div>
  )
}
