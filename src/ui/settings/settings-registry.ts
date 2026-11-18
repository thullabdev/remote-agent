/**
 * The settings the Settings tab shows, as data. The view renders each one with its control; the search matches its
 * title, description and keywords. Every setting here is a preference or state the dialog used to hold; none is new.
 */

export type SettingGroupId = 'appearance' | 'chat' | 'notifications'

export type SettingId =
  | 'theme'
  | 'colorTheme'
  | 'accent'
  | 'glow'
  | 'density'
  | 'fontSize'
  | 'enter'
  | 'codeWrap'
  | 'awayMode'
  | 'pushNotifications'

export type SettingGroup = { id: SettingGroupId; title: string; description: string }

export type SettingDefinition = {
  id: SettingId
  group: SettingGroupId
  title: string
  description: string
  keywords: readonly string[]
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  { id: 'appearance', title: 'Appearance', description: 'Theme, colors, and text size' },
  { id: 'chat', title: 'Chat', description: 'How messages are sent and shown' },
  { id: 'notifications', title: 'Notifications & presence', description: 'Away mode and push alerts' },
]

export const SETTINGS: readonly SettingDefinition[] = [
  {
    id: 'theme',
    group: 'appearance',
    title: 'Theme',
    description: 'Light, dark, or follow the system.',
    keywords: ['dark', 'light', 'mode', 'system'],
  },
  {
    id: 'colorTheme',
    group: 'appearance',
    title: 'Color theme',
    description: 'The palette the app is drawn with.',
    keywords: ['palette', 'colors'],
  },
  {
    id: 'accent',
    group: 'appearance',
    title: 'Accent',
    description: 'The highlight color for buttons and selections.',
    keywords: ['color', 'highlight'],
  },
  {
    id: 'glow',
    group: 'appearance',
    title: 'Glow (accent light in chat)',
    description: 'Accent light in chat.',
    keywords: ['light', 'highlight'],
  },
  {
    id: 'density',
    group: 'appearance',
    title: 'Density',
    description: 'How much space the lists and messages take.',
    keywords: ['compact', 'comfortable', 'spacing'],
  },
  {
    id: 'fontSize',
    group: 'appearance',
    title: 'Chat font size',
    description: 'The size of the text in chat.',
    keywords: ['text', 'size', 'font'],
  },
  {
    id: 'enter',
    group: 'chat',
    title: 'Enter in chat',
    description: 'Sends the message, or adds a new line.',
    keywords: ['send', 'newline', 'return'],
  },
  {
    id: 'codeWrap',
    group: 'chat',
    title: 'Long lines in code blocks',
    description: 'Scroll sideways inside a code block, or wrap onto the next line.',
    keywords: ['wrap', 'scroll', 'code'],
  },
  {
    id: 'awayMode',
    group: 'notifications',
    title: 'Away mode',
    description: 'When on, reports notify you if no device is focused on the chat.',
    keywords: ['notify', 'presence', 'away'],
  },
  {
    id: 'pushNotifications',
    group: 'notifications',
    title: 'Push notifications',
    description: 'Prompts always notify you. Reports notify you when Away mode is on and no device is focused on the chat.',
    keywords: ['notify', 'web push', 'alerts'],
  },
]

export function settingsIn(group: SettingGroupId): SettingDefinition[] {
  return SETTINGS.filter(setting => setting.group === group)
}
