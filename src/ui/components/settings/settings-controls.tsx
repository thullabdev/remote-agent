import type { ReactNode } from 'react'
import type { AccentPreference } from '../../preferences.ts'
import { COLOR_THEMES } from '../../themes.ts'

const accents: { value: AccentPreference; color: string }[] = [
  { value: 'ink', color: '#111111' },
  { value: 'olive', color: '#3F4A3C' },
  { value: 'blue', color: '#355C7D' },
  { value: 'clay', color: '#A05237' },
  { value: 'plum', color: '#704064' },
  { value: 'amber', color: '#A8701E' },
  { value: 'teal', color: '#1E6E6C' },
]

export function SettingLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-mono text-xs text-muted-foreground">{children}</div>
}

/** A row of choices where exactly one is pressed. The group is named by `label`. */
export function SettingSegments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange(value: T): void
}) {
  return (
    <section>
      <SettingLabel>{label}</SettingLabel>
      <div role="group" aria-label={label} className="flex gap-1 rounded-xl bg-muted p-1">
        {options.map(([option, title]) => (
          <button
            type="button"
            key={option}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`flex-1 rounded-lg py-1.5 text-sm transition-colors ${value === option ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground'}`}
          >
            {title}
          </button>
        ))}
      </div>
    </section>
  )
}

/** An on/off switch. The label is its accessible name. */
export function SettingSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={`${label} ${checked ? 'on' : 'off'}`}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

export function AccentSwatches({ value, onChange }: { value: AccentPreference; onChange(value: AccentPreference): void }) {
  return (
    <div className="flex gap-3">
      {accents.map(({ value: accent, color }) => (
        <button
          type="button"
          key={accent}
          aria-label={`${accent} accent`}
          aria-pressed={value === accent}
          onClick={() => onChange(accent)}
          className={`size-9 shrink-0 rounded-full border-2 p-1 ${value === accent ? 'border-primary' : 'border-border'}`}
        >
          <span className="block size-full rounded-full" style={{ backgroundColor: color }} />
        </button>
      ))}
    </div>
  )
}

export function ColorThemeGrid({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {COLOR_THEMES.map(theme => (
        <button
          type="button"
          key={theme.id}
          aria-pressed={value === theme.id}
          onClick={() => onChange(theme.id)}
          className={`flex items-center gap-2 rounded-xl border-2 p-2 text-left text-sm ${value === theme.id ? 'border-primary' : 'border-border'}`}
        >
          <span className="flex size-6 shrink-0 overflow-hidden rounded-full" aria-hidden="true">
            <span className="h-full w-1/2" style={{ backgroundColor: theme.light.background }} />
            <span className="h-full w-1/2" style={{ backgroundColor: theme.dark.background }} />
          </span>
          <span className="min-w-0 flex-1 truncate">{theme.label}</span>
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: theme.dark.primary }} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
