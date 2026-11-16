import { createElement, Fragment, type ComponentType, type ReactNode } from 'react'
import type { Chat } from '../channel/web/protocol.ts'

/**
 * Where an extension can show things in the host UI. The host renders what is registered here and knows nothing about
 * what it is. An extension registers from its frontend entry; the composition root imports that entry.
 */

/** The panel the main area shows instead of a chat, if any. `params` belong to the panel; the host does not read them. */
export type ActivePanel = { id: string; params: Record<string, string> }

export type OpenPanel = (id: string, params?: Record<string, string>) => void

/** Shows a short message to the user. Errors are shown as errors. */
export type Notify = (message: string, kind?: 'success' | 'error') => void

export type PanelContext = {
  params: Record<string, string>
  openPanel: OpenPanel
  /** Leaves the panel for the chat list. `replace` swaps the history entry instead of adding one. */
  closePanel(options?: { replace?: boolean }): void
  notify: Notify
  density: 'compact' | 'comfortable'
}

/** What a side tab's render gets. The side column, not the extension, decides when it is shown. */
export type SideTabContext = { chats: Chat[]; activePanel: ActivePanel | null; openPanel: OpenPanel; notify: Notify }
/** A tab's icon: any component that takes a class name, such as a lucide icon. */
export type SideTabIcon = ComponentType<{ className?: string }>
/** A tab in the side column's strip. Its render replaces the whole side panel while the tab is selected. */
export type SideTab = { title: string; icon: SideTabIcon; render: (context: SideTabContext) => ReactNode }

export type DashboardContext = { online: boolean; openPanel: OpenPanel; notify: Notify }
export type ChatActionContext = { chat: Chat; openPanel: OpenPanel; notify: Notify }

type Slot<C> = Map<string, (context: C) => ReactNode>

const sideTabsById = new Map<string, SideTab>()
const dashboard: Slot<DashboardContext> = new Map()
const chatActions: Slot<ChatActionContext> = new Map()

/** A tab in the side column's strip. The same id replaces the tab registered before it. */
export function registerSideTab(id: string, tab: SideTab): void {
  sideTabsById.set(id, tab)
}

/** A card on the General dashboard. */
export function registerDashboardCard(id: string, render: (context: DashboardContext) => ReactNode): void {
  dashboard.set(id, render)
}

/** A control in a chat's header. */
export function registerChatAction(id: string, render: (context: ChatActionContext) => ReactNode): void {
  chatActions.set(id, render)
}

function rendered<C>(slot: Slot<C>, context: C): ReactNode[] {
  return [...slot].map(([id, render]) => createElement(Fragment, { key: id }, render(context)))
}

/** The registered side tabs, in the order they were registered. Chats is not one of them: the host owns it. */
export function sideTabs(): Array<SideTab & { id: string }> {
  return [...sideTabsById].map(([id, tab]) => ({ id, ...tab }))
}

/** What a registered side tab renders now, or `null` when no tab has that id. */
export function sideTabRender(id: string, context: SideTabContext): ReactNode {
  const tab = sideTabsById.get(id)
  return tab === undefined ? null : tab.render(context)
}

export function dashboardCards(context: DashboardContext): ReactNode[] {
  return rendered(dashboard, context)
}

export function chatActionsFor(context: ChatActionContext): ReactNode[] {
  return rendered(chatActions, context)
}

/** For tests only. */
export function clearSlotsForTesting(): void {
  sideTabsById.clear()
  dashboard.clear()
  chatActions.clear()
}
