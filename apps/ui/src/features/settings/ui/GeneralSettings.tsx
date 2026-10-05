import { useEffect, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Select, type SelectOption } from '@localixai/kit/select'
import { Textarea } from '@localixai/kit/textarea'
import type { NotificationCondition, TerminalNotificationMethod } from '@localixai/notifications'
import { RESPONSE_DEFAULTS_MAX_CHARS, USER_PROFILE_FIELD_MAX_CHARS } from '@/shared/api/contracts'
import { shellCommandApi, type ShellCommandStatusDto } from '@/shared/api/shell-command-client'
import { useUserSettings } from '../model/useUserSettings'
import {
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsSurface,
} from './SettingsScaffold'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import {
  ROLE_OPTIONS,
  EXPERIENCE_OPTIONS,
  USECASE_OPTIONS,
  RESPONSE_STYLE_OPTIONS,
  hasStyleToken,
  toggleStyleToken,
} from '../model/profileOptions'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { Switch } from '@localixai/kit/switch'
import { useNotificationPrefs } from '@/shared/lib/notifications/prefs'
import { isDesktop } from '@localixai/kit/environment'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { DesktopUpdateSection } from './DesktopUpdateSection'
import { StorageSection } from './StorageSection'

// Each profile picker leads with a "Not set" option; prebuild the full arrays
// once so the Selects don't reconstruct them on every render.
const NOT_SET = { value: '', label: 'Not set' }
const ROLE_SELECT_OPTIONS = [NOT_SET, ...ROLE_OPTIONS]
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
const EXPERIENCE_SELECT_OPTIONS = [NOT_SET, ...EXPERIENCE_OPTIONS]
const USECASE_SELECT_OPTIONS = [NOT_SET, ...USECASE_OPTIONS]

const labelCls = 'text-2xs font-medium uppercase tracking-widest text-text-soft'

export function GeneralSettings() {
  const { settings, update } = useUserSettings()
  const [name, setName] = useState(settings.displayName)
  const [prefs, setPrefs] = useState(settings.responsePreferences)
  const [role, setRole] = useState(settings.primaryRole ?? '')
  const [experience, setExperience] = useState(settings.experienceLevel ?? '')
  const [useCase, setUseCase] = useState(settings.mainUseCase ?? '')

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setName(settings.displayName)
  }, [settings.displayName])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setPrefs(settings.responsePreferences)
  }, [settings.responsePreferences])

  return (
    <SettingsPage
      title="General"
      description="Profile details and default behaviour shared across your workspace."
    >
      <SettingsSection title="Profile" anchor="general-profile">
        <SettingsSurface className="space-y-6">
          {/* Display name */}
          <div className="space-y-2">
            <label htmlFor="display-name" className="text-sm font-normal text-foreground">
              Full name
            </label>
            <Input
              id="display-name"
              size="xl"
              className="border-border-soft bg-transparent"
              value={name}
              maxLength={USER_PROFILE_FIELD_MAX_CHARS}
              placeholder="Add your name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => update({ displayName: name.trim() })}
            />
          </div>

          {/* Work profile */}
          <div className="space-y-1">
            <p className="text-sm font-normal text-foreground">What best describes your work?</p>
            <p className="text-sm text-text-faint">
              This helps tailor examples, level of detail, and suggested workflows.
            </p>
            <p className="text-xs text-text-soft">
              Optional. These hints stay empty until you choose them.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
            <div className="space-y-2">
              <label className={labelCls}>Primary role</label>
              <Select
                className="w-full"
                value={role}
                onValueChange={(v) => {
                  setRole(v)
                  update({ primaryRole: v })
                }}
                options={ROLE_SELECT_OPTIONS}
              />
            </div>

            <div className="space-y-2">
              <label className={labelCls}>Experience level</label>
              <Select
                className="w-full"
                value={experience}
                onValueChange={(v) => {
                  setExperience(v)
                  update({ experienceLevel: v })
                }}
                options={EXPERIENCE_SELECT_OPTIONS}
              />
            </div>

            <div className="space-y-2 @lg:col-span-2">
              <label className={labelCls}>Main use case</label>
              <Select
                className="w-full"
                value={useCase}
                onValueChange={(v) => {
                  setUseCase(v)
                  update({ mainUseCase: v })
                }}
                options={USECASE_SELECT_OPTIONS}
              />
            </div>
          </div>
        </SettingsSurface>
      </SettingsSection>

      <SettingsSection
        anchor="general-response"
        title="Response defaults"
        description="Set defaults for tone, level of detail, and format. These preferences apply to all chats."
      >
        <SettingsSurface className="space-y-1.5">
          <label className="text-sm font-normal text-foreground" htmlFor="response-prefs">
            Response preferences
          </label>
          <div className="flex flex-wrap gap-1.5">
            {RESPONSE_STYLE_OPTIONS.map((o) => (
              <TogglePill
                key={o.value}
                active={hasStyleToken(prefs, o.phrase)}
                onClick={() => {
                  const next = toggleStyleToken(prefs, o.phrase)
                  setPrefs(next)
                  update({ responsePreferences: next })
                }}
              >
                {o.label}
              </TogglePill>
            ))}
          </div>
          <Textarea
            id="response-prefs"
            size="xl"
            className="min-h-24 resize-y"
            placeholder="E.g. Keep answers concise; prefer TypeScript examples; reply in my language; ask clarifying questions before large changes."
            value={prefs}
            maxLength={RESPONSE_DEFAULTS_MAX_CHARS}
            onChange={(e) => setPrefs(e.target.value)}
            onBlur={() => update({ responsePreferences: prefs })}
          />
        </SettingsSurface>
      </SettingsSection>

      <SettingsSection
        anchor="general-cli"
        title="Command line"
        description="Install the `localix` command so you can open projects and files from your terminal."
      >
        <SettingsRows>
          <ShellCommandRow />
        </SettingsRows>
      </SettingsSection>

      <DesktopUpdateSection />

      <StorageSection />

      <SettingsSection
        anchor="general-notifications"
        title="Notifications"
        description="Choose when important events may use native interruption. Every event still collects in the Event Center."
      >
        <SettingsRows>
          <NotificationConditionRow />
          <TerminalCompatibilityRow />
          <AppIconBadgeRow />
        </SettingsRows>
      </SettingsSection>
    </SettingsPage>
  )
}

function NotificationConditionRow() {
  const condition = useNotificationPrefs((s) => s.condition)
  const setCondition = useNotificationPrefs((s) => s.setCondition)

  return (
    <SettingsRow layout="responsive">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">Notify me</p>
        <p className="text-sm text-text-faint">
          Controls interruption for errors, input requests, and completed background runs. History
          remains available in the Event Center when interruptions are off.
        </p>
      </div>
      <Select
        aria-label="When to notify"
        className="w-40 shrink-0 @max-md:w-full"
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
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">Terminal compatibility</p>
        <p className="text-sm text-text-faint">
          Automatic uses detected capabilities. Choose a specific compatibility mode only when your
          terminal requires it.
        </p>
      </div>
      <Select
        aria-label="Terminal notification compatibility"
        className="w-40 shrink-0 @max-md:w-full"
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
 * Client-only preference (localStorage); no-op outside the desktop shell (and unsupported on
 * Windows).
 */
function AppIconBadgeRow() {
  const enabled = useNotificationPrefs((s) => s.appIconBadge)
  const setEnabled = useNotificationPrefs((s) => s.setAppIconBadge)

  return (
    <SettingsRow className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">Waiting count on the app icon</p>
        <p className="text-sm text-text-faint">
          Show how many conversations are waiting on you — a request, a plan to review, a mention —
          as a badge on the dock / taskbar app icon.
          {!isDesktop && ' Only available in the desktop app.'}
        </p>
      </div>
      <Switch
        aria-label="Waiting count on the app icon"
        checked={enabled}
        disabled={!isDesktop}
        onChange={() => setEnabled(!enabled)}
      />
    </SettingsRow>
  )
}

/**
 * "Install the `localix` command" — a PATH install. Reflects live
 * status (installed / stale / not-installed) and, when installed but its bin dir
 * isn't on PATH, tells the user which dir to add.
 */
function ShellCommandRow() {
  const workItemVisible = useWorkItemVisible()
  const [status, setStatus] = useState<ShellCommandStatusDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'install' | 'uninstall' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workItemVisible) return
    setLoading(true)
    setError(null)
    shellCommandApi
      .status()
      .then(setStatus)
      .catch((caught) => setError(inlineFailure(caught, 'Could not check the command status.')))
      .finally(() => setLoading(false))
  }, [workItemVisible])

  const run = async (action: 'install' | 'uninstall') => {
    setBusyAction(action)
    setError(null)
    try {
      setStatus(await shellCommandApi[action]())
    } catch (e) {
      setError(inlineFailure(e, `Could not ${action} the localix command.`))
    } finally {
      setBusyAction(null)
    }
  }

  const installed = status?.state === 'installed' || status?.state === 'stale'
  const unavailable = status != null && !status.available

  const summary = !status
    ? 'Command status is unavailable.'
    : unavailable
      ? 'Unavailable in this runtime. Portable Linux AppImage builds cannot install a durable launcher; use the .deb package.'
      : status.state === 'installed'
        ? 'Installed.'
        : status.state === 'stale'
          ? 'Installed, but points at an old location — reinstall to refresh.'
          : 'Not installed.'

  return (
    <SettingsRow className="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">
          Install the <span className="font-mono text-xs">localix</span> command
        </p>
        {loading ? (
          <ActivitySignal label="Checking command status" className="text-sm text-text-faint" />
        ) : (
          <p className="text-sm text-text-faint">
            {summary}{' '}
            {status && !unavailable && (
              <>
                Then run <span className="font-mono text-xs">localix .</span> or{' '}
                <span className="font-mono text-xs">localix &lt;file&gt;</span> to open it here.
              </>
            )}
          </p>
        )}
        {status && installed && !status.onPath && (
          <p className="text-sm text-status-warning">
            Add <span className="font-mono text-xs">{status.binDir}</span> to your PATH to use it.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {installed && (
          <Button
            variant="outline"
            size="xl"
            aria-busy={busyAction === 'uninstall' || undefined}
            disabled={busyAction !== null}
            onClick={() => {
              void run('uninstall')
            }}
          >
            {busyAction === 'uninstall' ? (
              <ActivitySignal label="Removing" className="text-sm" labelClassName="min-w-0" />
            ) : (
              'Uninstall'
            )}
          </Button>
        )}
        <Button
          variant="outline"
          size="xl"
          aria-busy={busyAction === 'install' || undefined}
          disabled={busyAction !== null || unavailable || !status}
          onClick={() => {
            void run('install')
          }}
        >
          {busyAction === 'install' ? (
            <ActivitySignal label="Installing" className="text-sm" labelClassName="min-w-0" />
          ) : status?.state === 'installed' ? (
            'Reinstall'
          ) : (
            'Install'
          )}
        </Button>
      </div>
    </SettingsRow>
  )
}
