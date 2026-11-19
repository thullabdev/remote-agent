import { Bell, BellOff, Check, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SettingDefinition } from '../../settings/settings-registry.ts'
import type { Preferences } from '../../preferences.ts'
import type { PushStatus } from '../../use-push-subscription.ts'
import { Button } from '../ui/button.tsx'
import { AccentSwatches, ColorThemeGrid, SettingLabel, SettingSegments, SettingSwitch } from './settings-controls.tsx'

/** What every setting row reads and writes. The side panel gets it from the app. */
export type SettingsContext = {
  preferences: Preferences
  onPreferences(preferences: Preferences): void
  away: boolean
  onAwayToggle(): void
  push: PushStatus
  pushBusy: boolean
  onPushToggle(): void
}

/** One setting: its control, labelled and wrapped so the search and the group can find it. */
export function SettingRow({ setting, context }: { setting: SettingDefinition; context: SettingsContext }) {
  return (
    <section data-setting={setting.id} className="rounded-2xl">
      {renderSetting(setting, context)}
    </section>
  )
}

function renderSetting(setting: SettingDefinition, context: SettingsContext): ReactNode {
  const { preferences, onPreferences } = context
  switch (setting.id) {
    case 'theme':
      return <SettingSegments label={setting.title} value={preferences.theme} onChange={theme => onPreferences({ ...preferences, theme })} options={[
        ['light', 'Light'], ['dark', 'Dark'], ['system', 'System'],
      ]} />
    case 'colorTheme':
      return (
        <div>
          <SettingLabel>{setting.title}</SettingLabel>
          <ColorThemeGrid value={preferences.palette} onChange={palette => onPreferences({ ...preferences, palette })} />
        </div>
      )
    case 'accent':
      return (
        <div>
          <SettingLabel>{setting.title}</SettingLabel>
          <AccentSwatches value={preferences.accent} onChange={accent => onPreferences({ ...preferences, accent })} />
        </div>
      )
    case 'glow':
      return <SettingSegments label={setting.title} value={preferences.glow} onChange={glow => onPreferences({ ...preferences, glow })} options={[
        ['off', 'Off'], ['soft', 'Soft'], ['strong', 'Strong'],
      ]} />
    case 'density':
      return <SettingSegments label={setting.title} value={preferences.density} onChange={density => onPreferences({ ...preferences, density })} options={[
        ['compact', 'Compact'], ['comfortable', 'Comfortable'],
      ]} />
    case 'fontSize':
      return (
        <>
          <SettingSegments label={setting.title} value={preferences.font} onChange={font => onPreferences({ ...preferences, font })} options={[
            ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'],
          ]} />
          <p
            className="mt-3 rounded-2xl bg-muted p-3 text-muted-foreground"
            style={{ fontSize: { small: '14px', medium: '16px', large: '18px' }[preferences.font] }}
          >
            Preview: The more I learn, the more I realize how much I still have to learn.
          </p>
        </>
      )
    case 'enter':
      return <SettingSegments label={setting.title} value={preferences.enter} onChange={enter => onPreferences({ ...preferences, enter })} options={[
        ['send', 'Sends'], ['newline', 'New line'],
      ]} />
    case 'codeWrap':
      return <SettingSegments label={setting.title} value={preferences.codeWrap} onChange={codeWrap => onPreferences({ ...preferences, codeWrap })} options={[
        ['scroll', 'Scroll'], ['wrap', 'Wrap'],
      ]} />
    case 'awayMode':
      return (
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
            <ShieldCheck className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{setting.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{setting.description}</p>
          </div>
          <SettingSwitch label={setting.title} checked={context.away} onChange={context.onAwayToggle} />
        </div>
      )
    case 'pushNotifications':
      return <PushSetting context={context} title={setting.title} description={setting.description} />
  }
}

function PushSetting({ context, title, description }: { context: SettingsContext; title: string; description: string }) {
  const { push, pushBusy, onPushToggle } = context
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
          {push.subscribed ? <Bell className="size-4" /> : <BellOff className="size-4 text-muted-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <Button variant={push.subscribed ? 'secondary' : 'outline'} size="sm" disabled={!push.supported || pushBusy} onClick={onPushToggle}>
          {pushBusy ? 'Updating…' : push.subscribed ? <><Check className="size-3" /> On</> : 'Enable'}
        </Button>
      </div>
      {!push.supported && <p className="mt-2 text-xs text-muted-foreground">This browser does not support Web Push notifications.</p>}
      {push.iosHomeScreenRequired && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          On iPhone and iPad, Web Push works in Safari only after you add this page to your Home Screen.
        </p>
      )}
    </div>
  )
}
