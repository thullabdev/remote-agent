import { ArrowLeft, Bell, BellOff, Check, ShieldCheck } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { settingsIn, SETTING_GROUPS, type SettingDefinition, type SettingGroupId, type SettingId } from '../../settings/settings-registry.ts'
import type { PushStatus } from '../../use-push-subscription.ts'
import type { Preferences } from '../../preferences.ts'
import { Button } from '../ui/button.tsx'
import { AccentSwatches, ColorThemeGrid, SettingLabel, SettingSegments, SettingSwitch } from './settings-controls.tsx'

export type SettingsViewProps = {
  group: SettingGroupId
  /** Scrolled to and briefly highlighted, when a search result opened this group. */
  focus?: SettingId
  preferences: Preferences
  onPreferences(preferences: Preferences): void
  away: boolean
  onAwayToggle(): void
  push: PushStatus
  pushBusy: boolean
  onPushToggle(): void
  /** Returns the main area to the group list on a phone, or to the chat or empty state on desktop. Omitted when there is nothing to return to. */
  onBack?(): void
}

const FOCUS_CLASSES = ['ring-2', 'ring-primary']

/**
 * The settings of one group, shown in the main area. The header matches the chat header and stays put while the settings
 * scroll underneath it. Each setting is a labelled section with its own control.
 */
export function SettingsView(props: SettingsViewProps) {
  const { group, focus, onBack } = props
  const groupInfo = SETTING_GROUPS.find(candidate => candidate.id === group)

  useEffect(() => {
    if (focus === undefined) {
      return
    }
    const element = document.getElementById(`setting-${focus}`)
    element?.scrollIntoView({ block: 'center' })
    element?.classList.add(...FOCUS_CLASSES)
    const timer = window.setTimeout(() => element?.classList.remove(...FOCUS_CLASSES), 1500)
    return () => {
      window.clearTimeout(timer)
      element?.classList.remove(...FOCUS_CLASSES)
    }
  }, [focus, group])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="chat-header-glass flex h-[4.25rem] shrink-0 items-center gap-2 bg-background/85 px-2 backdrop-blur md:px-4">
        {onBack && (
          <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-semibold tracking-tight">{groupInfo?.title ?? ''}</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{groupInfo?.description ?? ''}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 max-md:pb-24">
        <div className="grid gap-5">
          {settingsIn(group).map(setting => (
            <section key={setting.id} id={`setting-${setting.id}`} data-setting={setting.id} className="scroll-mt-4 rounded-2xl">
              {renderSetting(setting, props)}
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}

function renderSetting(setting: SettingDefinition, props: SettingsViewProps): ReactNode {
  const { preferences, onPreferences } = props
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
          <SettingSwitch label={setting.title} checked={props.away} onChange={props.onAwayToggle} />
        </div>
      )
    case 'pushNotifications':
      return <PushSetting {...props} title={setting.title} description={setting.description} />
  }
}

function PushSetting({
  title,
  description,
  push,
  pushBusy,
  onPushToggle,
}: SettingsViewProps & { title: string; description: string }) {
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
