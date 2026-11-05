import { Bell, BellOff, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PushStatus } from '../use-push-subscription.ts'
import type { AccentPreference, Preferences } from '../preferences.ts'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Separator } from './ui/separator.tsx'

const accents: { value: AccentPreference; color: string }[] = [
  { value: 'ink', color: '#111111' },
  { value: 'olive', color: '#3F4A3C' },
  { value: 'blue', color: '#355C7D' },
  { value: 'clay', color: '#A05237' },
  { value: 'plum', color: '#704064' },
  { value: 'amber', color: '#A8701E' },
  { value: 'teal', color: '#1E6E6C' },
]

type SettingsDialogProps = {
  open: boolean
  preferences: Preferences
  push: PushStatus
  pushBusy: boolean
  onPreferences(preferences: Preferences): void
  onPushToggle(): void
  onOpenChange(open: boolean): void
}

export function SettingsDialog({ open, preferences, push, pushBusy, onPreferences, onPushToggle, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[90dvh] w-full translate-y-0 flex flex-col gap-5 rounded-b-none rounded-t-3xl bg-background p-5 sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,28rem)] sm:-translate-y-1/2 sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Settings</DialogTitle>
          <DialogDescription>These appearance preferences are stored on this device.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <SettingSegments label="Theme" value={preferences.theme} onChange={theme => onPreferences({ ...preferences, theme })} options={[
            ['light', 'Light'], ['dark', 'Dark'], ['system', 'System'],
          ]} />
          <section>
            <SettingLabel>Accent</SettingLabel>
            <div className="flex gap-3">
              {accents.map(({ value, color }) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`${value} accent`}
                  aria-pressed={preferences.accent === value}
                  onClick={() => onPreferences({ ...preferences, accent: value })}
                  className={`size-9 shrink-0 rounded-full border-2 p-1 ${preferences.accent === value ? 'border-primary' : 'border-border'}`}
                >
                  <span className="block size-full rounded-full" style={{ backgroundColor: color }} />
                </button>
              ))}
            </div>
          </section>
          <SettingSegments label="Glow (accent light in chat)" value={preferences.glow} onChange={glow => onPreferences({ ...preferences, glow })} options={[
            ['off', 'Off'], ['soft', 'Soft'], ['strong', 'Strong'],
          ]} />
          <SettingSegments label="Density" value={preferences.density} onChange={density => onPreferences({ ...preferences, density })} options={[
            ['compact', 'Compact'], ['comfortable', 'Comfortable'],
          ]} />
          <SettingSegments label="Chat font size" value={preferences.font} onChange={font => onPreferences({ ...preferences, font })} options={[
            ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'],
          ]} />
          <p
            className="rounded-2xl bg-muted p-3 text-muted-foreground"
            style={{ fontSize: { small: '14px', medium: '16px', large: '18px' }[preferences.font] }}
          >
            Preview: The more I learn, the more I realize how much I still have to learn.
          </p>
        </div>

        <Separator />
        <section>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
              {push.subscribed ? <Bell className="size-4" /> : <BellOff className="size-4 text-muted-foreground" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Push notifications</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Prompts always notify you. Reports notify you when Away mode is on and no device is focused on the chat.
              </p>
            </div>
            <Button
              variant={push.subscribed ? 'secondary' : 'outline'}
              size="sm"
              disabled={!push.supported || pushBusy}
              onClick={onPushToggle}
            >
              {pushBusy ? 'Updating…' : push.subscribed ? <><Check className="size-3" /> On</> : 'Enable'}
            </Button>
          </div>
          {!push.supported && <p className="mt-2 text-xs text-muted-foreground">This browser does not support Web Push notifications.</p>}
          {push.iosHomeScreenRequired && (
            <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              On iPhone and iPad, Web Push works in Safari only after you add this page to your Home Screen.
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}

function SettingLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-mono text-xs text-muted-foreground">{children}</div>
}

function SettingSegments<T extends string>({
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
      <div className="flex gap-1 rounded-xl bg-muted p-1">
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
