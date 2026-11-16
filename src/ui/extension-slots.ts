import { createElement, Fragment, type ReactNode } from 'react'
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

export type SidebarContext = { chats: Chat[]; activePanel: ActivePanel | null; openPanel: OpenPanel; notify: Notify }
export type DashboardContext = { online: boolean; openPanel: OpenPanel; notify: Notify }
export type ChatActionContext = { chat: Chat; openPanel: OpenPanel; notify: Notify }

type Slot<C> = Map<string, (context: C) => ReactNode>

const sidebar: Slot<SidebarContext> = new Map()
const dashboard: Slot<DashboardContext> = new Map()
const chatActions: Slot<ChatActionContext> = new Map()

/** A section shown above the chat list in the sidebar. */
export function registerSidebarSection(id: string, render: (context: SidebarContext) => ReactNode): void {
  sidebar.set(id, render)
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

export function sidebarSections(context: SidebarContext): ReactNode[] {
  return rendered(sidebar, context)
}

export function dashboardCards(context: DashboardContext): ReactNode[] {
  return rendered(dashboard, context)
}

export function chatActionsFor(context: ChatActionContext): ReactNode[] {
  return rendered(chatActions, context)
}

/** For tests only. */
export function clearSlotsForTesting(): void {
  sidebar.clear()
  dashboard.clear()
  chatActions.clear()
}
