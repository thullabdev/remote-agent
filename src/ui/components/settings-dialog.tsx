import { Bell, BellOff, Check, ShieldCheck } from 'lucide-react'
import type { PushStatus } from '../use-push-subscription.ts'
import type { Preferences } from '../preferences.ts'
import { AccentSwatches, ColorThemeGrid, SettingLabel, SettingSegments, SettingSwitch } from './settings/settings-controls.tsx'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Separator } from './ui/separator.tsx'

type SettingsDialogProps = {
  open: boolean
  preferences: Preferences
  push: PushStatus
  pushBusy: boolean
  away: boolean
  onPreferences(preferences: Preferences): void
  onPushToggle(): void
  onAwayToggle(): void
  onOpenChange(open: boolean): void
}

export function SettingsDialog({ open, preferences, push, pushBusy, away, onPreferences, onPushToggle, onAwayToggle, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[90dvh] w-full translate-y-0 flex flex-col gap-5 rounded-b-none rounded-t-3xl bg-background p-5 sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,28rem)] sm:-translate-y-1/2 sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Settings</DialogTitle>
          <DialogDescription>These appearance preferences are stored on this device.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <section className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Away mode</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                When on, reports notify you if no device is focused on the chat.
              </p>
            </div>
            <SettingSwitch label="Away mode" checked={away} onChange={onAwayToggle} />
          </section>
          <SettingSegments label="Theme" value={preferences.theme} onChange={theme => onPreferences({ ...preferences, theme })} options={[
            ['light', 'Light'], ['dark', 'Dark'], ['system', 'System'],
          ]} />
          <section>
            <SettingLabel>Color theme</SettingLabel>
            <ColorThemeGrid value={preferences.palette} onChange={palette => onPreferences({ ...preferences, palette })} />
          </section>
          <section>
            <SettingLabel>Accent</SettingLabel>
            <AccentSwatches value={preferences.accent} onChange={accent => onPreferences({ ...preferences, accent })} />
          </section>
          <SettingSegments label="Glow (accent light in chat)" value={preferences.glow} onChange={glow => onPreferences({ ...preferences, glow })} options={[
            ['off', 'Off'], ['soft', 'Soft'], ['strong', 'Strong'],
          ]} />
          <SettingSegments label="Enter in chat" value={preferences.enter} onChange={enter => onPreferences({ ...preferences, enter })} options={[
            ['send', 'Sends'], ['newline', 'New line'],
          ]} />
          <SettingSegments label="Long lines in code blocks" value={preferences.codeWrap} onChange={codeWrap => onPreferences({ ...preferences, codeWrap })} options={[
            ['scroll', 'Scroll'], ['wrap', 'Wrap'],
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
