import type { MiniAppRecord, Project } from '@/shared/api/contracts'
import { projectScopeLabel } from '@/shared/lib/projectScope'
import { miniAppSettingsAnchor, miniAppSettingsUri } from '@/shared/lib/settingsAnchors'
import { Button } from '@localixai/kit/button'
import { Switch } from '@localixai/kit/switch'
import { miniAppLabel } from '@localixai/mini-app-sdk/manifest-label'
import { SettingsConfigForm } from '../SettingsConfigForm'
import {
  SettingProblems,
  SettingRegistryMeta,
  SettingRegistryRow,
  type SettingRegistryMetaItem,
} from '../settingRegistry'

/**
 * One installed mini app as a registry row: what it gives the agent and the workbench, its switch,
 * and its settings form when expanded. A mini app Localix ships is switched off, never removed.
 */
export function MiniAppRow({
  app,
  projects,
  busy,
  busyLabel,
  configOpen,
  onToggle,
  onRemove,
  onToggleConfig,
  onSaveConfig,
}: {
  app: MiniAppRecord
  projects: Project[]
  busy: boolean
  busyLabel: string | null
  configOpen: boolean
  onToggle: () => void
  onRemove: () => void
  onToggleConfig: () => void
  onSaveConfig: (values: Record<string, string | number | boolean>) => void
}) {
  const label = miniAppLabel(app)
  const errors = app.error ? [app.error] : []
  const state = errors.length
    ? 'error'
    : app.enabled
      ? 'enabled'
      : app.awaitingConsent
        ? 'neutral'
        : 'disabled'
  const count = (n: number, noun: string) =>
    n ? [{ label: `${n} ${noun}${n === 1 ? '' : 's'}` }] : []
  const metadata: SettingRegistryMetaItem[] = [
    ...(app.version ? [{ label: `v${app.version}` }] : []),
    { label: projectScopeLabel(projects, app.projectId) },
    ...(app.category ? [{ label: app.category }] : []),
    ...(app.awaitingConsent
      ? [
          {
            label: 'awaiting your yes',
            title: 'Installed from outside Localix, so its code has not run yet',
          },
        ]
      : []),
    ...(app.hasBackend
      ? [{ label: 'runs code', tone: 'warning' as const, title: 'Its backend runs while it is on' }]
      : []),
    ...count(app.tools.length, 'tool'),
    ...count(app.views.length, 'screen'),
    ...count(app.commands.length, 'command'),
    ...(app.hasGuide
      ? [{ label: 'guide', title: 'The agent reads its guide before using it' }]
      : []),
  ]

  return (
    <SettingRegistryRow
      state={state}
      anchor={miniAppSettingsAnchor(app.name)}
      uiTargetUri={miniAppSettingsUri(app.name, app.projectId)}
      busyLabel={busyLabel ?? undefined}
      toggle={
        <Switch
          checked={app.enabled}
          disabled={busy}
          onChange={onToggle}
          aria-label={`${app.enabled ? 'Turn off' : 'Turn on'} ${label}`}
        />
      }
      actions={
        <>
          {app.config.length > 0 && (
            <Button variant="ghost" size="default" onClick={onToggleConfig} disabled={busy}>
              Settings
            </Button>
          )}
          {!app.bundled && (
            <Button variant="destructive" size="default" onClick={onRemove} disabled={busy}>
              Remove
            </Button>
          )}
        </>
      }
      header={
        <>
          <div className="flex min-w-0 max-w-full items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{label}</span>
            {label !== app.name && (
              <code className="min-w-0 truncate text-2xs text-text-faint">{app.name}</code>
            )}
          </div>
          <SettingRegistryMeta items={metadata} />
          {app.description && (
            <p className="mt-1 truncate text-xs text-text-faint" title={app.description}>
              {app.description}
            </p>
          )}
        </>
      }
    >
      <SettingProblems
        className="mt-2 ml-5"
        subject={label}
        errors={errors}
        warnings={[]}
        consequence="none"
      />
      {app.enabled && app.tools.length > 0 && (
        <p
          className="mt-2 ml-5 truncate text-xs text-text-faint"
          title={app.tools.map((tool) => tool.name).join(', ')}
        >
          Tools:{' '}
          <span className="font-mono text-text-soft">
            {app.tools.map((tool) => tool.name).join(', ')}
          </span>
        </p>
      )}
      {configOpen && app.config.length > 0 && (
        <SettingsConfigForm fields={app.config} busy={busy} onSave={onSaveConfig} />
      )}
    </SettingRegistryRow>
  )
}
