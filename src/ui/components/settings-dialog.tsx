import { Bell, BellOff, Check, Monitor } from 'lucide-react'
import type { ChangeEvent } from 'react'
import type { PushStatus } from '../use-push-subscription.ts'
import type { Preferences } from '../preferences.ts'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Separator } from './ui/separator.tsx'

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
  const update = (event: ChangeEvent<HTMLSelectElement>) => {
    const key = event.target.name as keyof Preferences
    onPreferences({ ...preferences, [key]: event.target.value })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[90dvh] w-full translate-y-0 rounded-b-none rounded-t-3xl p-4 sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,34rem)] sm:-translate-y-1/2 sm:rounded-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Settings</DialogTitle>
          <DialogDescription>These appearance preferences are stored on this device.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <SettingSelect label="Theme" name="theme" value={preferences.theme} onChange={update} options={[
            ['system', 'System'], ['light', 'Light'], ['dark', 'Dark'],
          ]} icon={<Monitor className="size-4" />} />
          <SettingSelect label="Accent" name="accent" value={preferences.accent} onChange={update} options={[
            ['ink', 'Ink'], ['olive', 'Olive'], ['blue', 'Blue'], ['clay', 'Clay'], ['plum', 'Plum'], ['amber', 'Amber'], ['teal', 'Teal'],
          ]} />
          <SettingSelect label="Chat glow" name="glow" value={preferences.glow} onChange={update} options={[
            ['off', 'Off'], ['soft', 'Soft'], ['strong', 'Strong'],
          ]} />
          <SettingSelect label="Density" name="density" value={preferences.density} onChange={update} options={[
            ['comfortable', 'Comfortable'], ['compact', 'Compact'],
          ]} />
          <SettingSelect label="Message size" name="font" value={preferences.font} onChange={update} options={[
            ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'],
          ]} />
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

function SettingSelect({
  label,
  name,
  value,
  options,
  onChange,
  icon,
}: {
  label: string
  name: keyof Preferences
  value: string
  options: [string, string][]
  onChange(event: ChangeEvent<HTMLSelectElement>): void
  icon?: React.ReactNode
}) {
  return (
    <label className="grid grid-cols-[7.5rem_1fr] items-center gap-3 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">{icon}{label}</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="h-10 min-w-0 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
      >
        {options.map(([option, title]) => <option value={option} key={option}>{title}</option>)}
      </select>
    </label>
  )
}
