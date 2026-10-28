import type { NotificationCondition, TerminalNotificationMethod } from '@localixai/notifications'
import { Select, type SelectOption } from '@localixai/kit/select'
import { Switch } from '@localixai/kit/switch'
import { isDesktop, OS_FAMILY } from '@localixai/kit/environment'
import { useNotificationPrefs } from '@/shared/lib/notifications/prefs'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { SettingsRow, SettingsRows, SettingsSection } from './SettingsScaffold'

const NOTIFICATION_CONDITION_OPTIONS: SelectOption[] = [
  { value: 'always', label: 'Always' },
  { value: 'unfocused', label: 'When app is inactive' },
  { value: 'off', label: 'Never' },
]
const TERMINAL_METHOD_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'osc9', label: 'OSC 9' },
  { value: 'osc777', label: 'OSC 777' },
  { value: 'bel', label: 'Audible bell' },
]

/** Settings → Preferences → Notifications: when an event may interrupt, and the dock badge. */
export function NotificationsSection() {
  return (
    <SettingsSection
      anchor="prefs-notifications"
      title="Notifications"
      scope="device"
      description="Control interruptions and the app icon badge. Events always remain in the Event Center."
    >
      <SettingsRows>
        <NotificationConditionRow />
        <AppIconBadgeRow />
      </SettingsRows>
      <div data-settings-anchor="prefs-notifications-advanced" data-settings-reveal>
        <CollapsibleSection title="Advanced" defaultOpen={false}>
          <SettingsRows>
            <TerminalCompatibilityRow />
          </SettingsRows>
        </CollapsibleSection>
      </div>
    </SettingsSection>
  )
}

function NotificationConditionRow() {
  const condition = useNotificationPrefs((s) => s.condition)
  const setCondition = useNotificationPrefs((s) => s.setCondition)

  return (
    <SettingsRow layout="responsive">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">Notify me</p>
        <p className="max-w-prose text-xs leading-5 text-text-soft text-pretty">
          Errors, input requests, and completed background runs.
        </p>
      </div>
      <Select
        size="xl"
        aria-label="When to notify"
        className="w-52 shrink-0 @max-xl:w-full"
        value={condition}
        options={NOTIFICATION_CONDITION_OPTIONS}
        onValueChange={(value) => setCondition(value as NotificationCondition)}
      />
    </SettingsRow>
  )
}

function TerminalCompatibilityRow() {
  const terminalMethod = useNotificationPrefs((s) => s.terminalMethod)
  const setTerminalMethod = useNotificationPrefs((s) => s.setTerminalMethod)

  return (
    <SettingsRow layout="responsive">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">Terminal compatibility</p>
        <p className="max-w-prose text-xs leading-5 text-text-soft text-pretty">
          Use Automatic unless your terminal needs a specific notification protocol.
        </p>
      </div>
      <Select
        size="xl"
        aria-label="Terminal notification compatibility"
        className="w-52 shrink-0 @max-xl:w-full"
        value={terminalMethod}
        options={TERMINAL_METHOD_OPTIONS}
        onValueChange={(value) => setTerminalMethod(value as TerminalNotificationMethod)}
      />
    </SettingsRow>
  )
}

/**
 * "App icon badge" toggle — show how many conversations are waiting on the person on the native
 * dock (macOS) / taskbar-adjacent (Linux) app icon (`useDockBadge`, the badge's one writer).
 * Client-only preference; Windows uses a taskbar dot, other desktop platforms use a count.
 */
function AppIconBadgeRow() {
  const enabled = useNotificationPrefs((s) => s.appIconBadge)
  const setEnabled = useNotificationPrefs((s) => s.setAppIconBadge)
  const title =
    OS_FAMILY === 'windows' ? 'Waiting indicator on the app icon' : 'Waiting count on the app icon'

  return (
    <SettingsRow className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-prose text-xs leading-5 text-text-soft text-pretty">
          Show how many conversations are waiting on you — a request or a plan to review —
          {OS_FAMILY === 'windows'
            ? 'as a dot on the taskbar icon.'
            : 'as a badge on the app icon.'}
          {!isDesktop && ' Only available in the desktop app.'}
        </p>
      </div>
      <Switch
        aria-label={title}
        checked={enabled}
        disabled={!isDesktop}
        onChange={() => setEnabled(!enabled)}
      />
    </SettingsRow>
  )
}
