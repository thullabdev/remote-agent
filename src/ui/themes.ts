/**
 * Color themes. Each theme has a light and a dark palette, so the mode preference (light / dark / system)
 * and the theme preference combine freely. To add a theme, append an object to COLOR_THEMES.
 * Glow is an "r g b" triple used by the chat glow.
 */

export type ThemeMode = 'light' | 'dark'

export type Palette = {
  background: string
  foreground: string
  card: string
  muted: string
  mutedForeground: string
  border: string
  accent: string
  primary: string
  primaryForeground: string
  glow: string
}

export type ColorTheme = {
  id: string
  label: string
  light: Palette
  dark: Palette
}

export const DEFAULT_COLOR_THEME = 'default'

export const COLOR_THEMES: readonly ColorTheme[] = [
  {
    id: 'default',
    label: 'Remote Agent',
    light: {
      background: '#eef2fb', foreground: '#0d1230', card: '#eff3fb', muted: '#e1e7f5', mutedForeground: '#5b6486',
      border: '#c9d2e9', accent: '#dce4ff', primary: '#0d1230', primaryForeground: '#f4f7ff', glow: '128 146 190',
    },
    dark: {
      background: '#0b1024', foreground: '#e8ecfa', card: '#171c2f', muted: '#1b2243', mutedForeground: '#a0a9c8',
      border: '#2e3762', accent: '#1f2b5c', primary: '#e8ecfa', primaryForeground: '#0b1024', glow: '84 98 150',
    },
  },
  {
    id: 'vscode',
    label: 'VS Code',
    light: {
      background: '#ffffff', foreground: '#3b3b3b', card: '#ffffff', muted: '#e8e8e8', mutedForeground: '#686868',
      border: '#d4d4d4', accent: '#e4e6f1', primary: '#005fb8', primaryForeground: '#ffffff', glow: '0 120 212',
    },
    dark: {
      background: '#1f1f1f', foreground: '#cccccc', card: '#2a2a2a', muted: '#2d2d30', mutedForeground: '#9d9d9d',
      border: '#3c3c3c', accent: '#04395e', primary: '#0078d4', primaryForeground: '#ffffff', glow: '0 120 212',
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    light: {
      background: '#ffffff', foreground: '#1f2328', card: '#ffffff', muted: '#eaeef2', mutedForeground: '#59636e',
      border: '#d1d9e0', accent: '#ddf4ff', primary: '#0969da', primaryForeground: '#ffffff', glow: '9 105 218',
    },
    dark: {
      background: '#0d1117', foreground: '#e6edf3', card: '#191d23', muted: '#21262d', mutedForeground: '#9198a1',
      border: '#30363d', accent: '#1f3a5f', primary: '#4493f8', primaryForeground: '#0d1117', glow: '68 147 248',
    },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    light: {
      background: '#fdf6e3', foreground: '#586e75', card: '#fdf6e4', muted: '#eee8d5', mutedForeground: '#566c73',
      border: '#d8d2bd', accent: '#e6dfca', primary: '#268bd2', primaryForeground: '#fdf6e3', glow: '38 139 210',
    },
    dark: {
      background: '#002b36', foreground: '#839496', card: '#0d3640', muted: '#073642', mutedForeground: '#8d9d9e',
      border: '#114b57', accent: '#094654', primary: '#268bd2', primaryForeground: '#fdf6e3', glow: '38 139 210',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    light: {
      background: '#fffbeb', foreground: '#1f1f1f', card: '#fffbec', muted: '#e8e3cc', mutedForeground: '#6a654a',
      border: '#cfcfde', accent: '#d5d1de', primary: '#644ac9', primaryForeground: '#fffbeb', glow: '100 74 201',
    },
    dark: {
      background: '#282a36', foreground: '#f8f8f2', card: '#333540', muted: '#44475a', mutedForeground: '#aeb6cf',
      border: '#44475a', accent: '#3d3f4f', primary: '#bd93f9', primaryForeground: '#282a36', glow: '189 147 249',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    light: {
      background: '#eceff4', foreground: '#2e3440', card: '#edf0f5', muted: '#d8dee9', mutedForeground: '#4c566a',
      border: '#cdd3de', accent: '#d8dee9', primary: '#5e81ac', primaryForeground: '#eceff4', glow: '94 129 172',
    },
    dark: {
      background: '#2e3440', foreground: '#eceff4', card: '#383e4a', muted: '#434c5e', mutedForeground: '#b3bccb',
      border: '#4c566a', accent: '#434c5e', primary: '#88c0d0', primaryForeground: '#2e3440', glow: '136 192 208',
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    light: {
      background: '#fbf1c7', foreground: '#3c3836', card: '#fbf2ca', muted: '#ebdbb2', mutedForeground: '#695e56',
      border: '#d5c4a1', accent: '#ebdbb2', primary: '#076678', primaryForeground: '#fbf1c7', glow: '7 102 120',
    },
    dark: {
      background: '#282828', foreground: '#ebdbb2', card: '#333333', muted: '#504945', mutedForeground: '#c8b99a',
      border: '#504945', accent: '#504945', primary: '#fabd2f', primaryForeground: '#282828', glow: '250 189 47',
    },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    light: {
      background: '#eff1f5', foreground: '#4c4f69', card: '#f0f2f6', muted: '#ccd0da', mutedForeground: '#555871',
      border: '#bcc0cc', accent: '#dce0e8', primary: '#8839ef', primaryForeground: '#eff1f5', glow: '136 57 239',
    },
    dark: {
      background: '#1e1e2e', foreground: '#cdd6f4', card: '#292938', muted: '#45475a', mutedForeground: '#afb6d2',
      border: '#45475a', accent: '#313244', primary: '#cba6f7', primaryForeground: '#1e1e2e', glow: '203 166 247',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    light: {
      background: '#e1e2e7', foreground: '#3760bf', card: '#e2e3e8', muted: '#c4c8da', mutedForeground: '#2e51a0',
      border: '#a8aecb', accent: '#c4c8da', primary: '#2e7de9', primaryForeground: '#e1e2e7', glow: '46 125 233',
    },
    dark: {
      background: '#1a1b26', foreground: '#c0caf5', card: '#252631', muted: '#292e42', mutedForeground: '#8b94bf',
      border: '#3b4261', accent: '#292e42', primary: '#7aa2f7', primaryForeground: '#1a1b26', glow: '122 162 247',
    },
  },
]

export const ACCENTS = ['ink', 'olive', 'blue', 'clay', 'plum', 'amber', 'teal'] as const
export type AccentId = (typeof ACCENTS)[number]

/** `ink` keeps the theme's own primary; the others replace primary and glow in both modes. */
const ACCENT_COLORS: Record<Exclude<AccentId, 'ink'>, Record<ThemeMode, Pick<Palette, 'primary' | 'primaryForeground' | 'glow'>>> = {
  olive: {
    light: { primary: '#3f4a3c', primaryForeground: '#f7f6f2', glow: '96 125 88' },
    dark: { primary: '#869880', primaryForeground: '#171715', glow: '120 160 108' },
  },
  blue: {
    light: { primary: '#355c7d', primaryForeground: '#f7f6f2', glow: '60 120 190' },
    dark: { primary: '#76a3c7', primaryForeground: '#171715', glow: '80 140 220' },
  },
  clay: {
    light: { primary: '#a05237', primaryForeground: '#f7f6f2', glow: '200 100 60' },
    dark: { primary: '#d68264', primaryForeground: '#171715', glow: '230 120 80' },
  },
  plum: {
    light: { primary: '#704064', primaryForeground: '#f7f6f2', glow: '150 70 140' },
    dark: { primary: '#b27ca8', primaryForeground: '#171715', glow: '200 110 190' },
  },
  amber: {
    light: { primary: '#a8701e', primaryForeground: '#f7f6f2', glow: '210 140 30' },
    dark: { primary: '#e0aa50', primaryForeground: '#171715', glow: '240 180 70' },
  },
  teal: {
    light: { primary: '#1e6e6c', primaryForeground: '#f7f6f2', glow: '30 140 135' },
    dark: { primary: '#50b4b0', primaryForeground: '#171715', glow: '60 200 190' },
  },
}

/**
 * Colors for what a session is doing. They belong to the mode, not to a theme or accent: the accent is user-chosen and could
 * match them. themes.test.ts checks every theme's surfaces give them at least 4.5:1 contrast.
 */
export const STATUS_COLORS: Record<ThemeMode, { needs: string; working: string }> = {
  light: { needs: '#78350f', working: '#14532d' },
  dark: { needs: '#fcd34d', working: '#86efac' },
}

/** CSS custom properties for a theme, mode and accent. Every key is always returned, so applying them overwrites the previous theme. */
export function appearanceVars(themeId: string, mode: ThemeMode, accent: AccentId): Record<string, string> {
  const theme = COLOR_THEMES.find(candidate => candidate.id === themeId) ?? COLOR_THEMES[0]
  if (theme === undefined) {
    throw new Error('No color themes are defined.')
  }
  const palette: Palette = { ...theme[mode], ...(accent === 'ink' ? {} : ACCENT_COLORS[accent][mode]) }
  return {
    '--background': palette.background,
    '--foreground': palette.foreground,
    '--card': palette.card,
    '--muted': palette.muted,
    '--muted-foreground': palette.mutedForeground,
    '--border': palette.border,
    '--accent': palette.accent,
    '--primary': palette.primary,
    '--primary-foreground': palette.primaryForeground,
    '--glow': palette.glow,
    '--status-needs': STATUS_COLORS[mode].needs,
    '--status-working': STATUS_COLORS[mode].working,
  }
}
