import { pluginCapabilityLabels, pluginIssueSummary } from '@localixai/api/plugin-presentation'
import type { PluginRecord, PluginUpdateJob, Project } from '@/shared/api/contracts'
import type { ModSummary } from '@/shared/api/modsApi'
import { projectScopeLabel } from '@/shared/lib/projectScope'
import { pluginSettingsAnchor, pluginSettingsUri } from '@/shared/lib/settingsAnchors'
import { Button } from '@localixai/kit/button'
import { Switch } from '@localixai/kit/switch'
import { SettingsConfigForm } from '../SettingsConfigForm'
import {
  SettingProblems,
  SettingRegistryMeta,
  SettingRegistryRow,
  type SettingRegistryMetaItem,
} from '../settingRegistry'

/** An update the marketplace listing offers for this plugin, and its job when one is running. */
export interface PluginRowUpdate {
  /** `<name>@<marketplace>`. */
  id: string
  from: string
  to: string
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** What a running mod does, in one quiet line: the events it hooks, whether it draws, its panes. */
export function modLine(mod: ModSummary): string {
  return [
    mod.events.length > 0 ? `Hooks ${mod.events.join(', ')}` : 'Hooks nothing yet',
    ...(mod.draws ? ['draws on screen'] : []),
    ...(mod.panes > 0 ? [`${plural(mod.panes, 'pane')} open`] : []),
  ].join(' · ')
}

const UPDATE_PHASE_LABEL: Record<Exclude<PluginUpdateJob['phase'], 'failed' | 'done'>, string> = {
  checking: 'Checking',
  downloading: 'Downloading',
  installing: 'Installing',
}

/**
 * One Claude Code plugin as a registry row: what it provides, where it came from, its enable
 * switch, its config form when expanded, and — for one installed from a marketplace — Update now
 * when the listing offers a newer version. A built-in plugin (shipped inside Localix) can be
 * switched off but has no Remove and no Update: it updates with Localix. Mini apps have their own
 * rows.
 */
export function PluginRow({
  plugin,
  projects,
  busy,
  busyLabel,
  configOpen,
  update,
  updateJob,
  onToggle,
  onRemove,
  onUpdate,
  onToggleConfig,
  onSaveConfig,
  mod,
}: {
  plugin: PluginRecord
  /** Its mod, when it has a hooks module that Localix runs (`/rpc/mods`). */
  mod?: ModSummary
  projects: Project[]
  busy: boolean
  busyLabel: string | null
  configOpen: boolean
  /** The newer version its marketplace lists, if any. */
  update?: PluginRowUpdate
  /** The update job for this plugin, while it runs or once it failed. */
  updateJob?: Pick<PluginUpdateJob, 'phase' | 'error'>
  onToggle: () => void
  onRemove: () => void
  onUpdate?: () => void
  onToggleConfig: () => void
  onSaveConfig: (values: Record<string, string | number | boolean>) => void
}) {
  const builtin = plugin.builtin === true
  const offered = !builtin && update ? update : null
  const updating =
    updateJob && updateJob.phase !== 'done' && updateJob.phase !== 'failed' ? updateJob.phase : null
  const configurable = plugin.config.length > 0
  const chips = pluginCapabilityLabels(plugin.provides)

  const projName = projectScopeLabel(projects, plugin.projectId)
  // Static validation from the loader (same data `/plugin list` shows in chat).
  const issues = pluginIssueSummary(plugin)
  const { errors } = issues
  // A mod that did not load is a warning on its plugin's row: the rest of the plugin still runs.
  const warnings =
    mod?.status === 'failed'
      ? [...issues.warnings, `The mod did not load: ${mod.problem ?? 'unknown reason'}`]
      : issues.warnings
  const state =
    errors.length > 0
      ? 'error'
      : warnings.length > 0
        ? 'warning'
        : plugin.enabled
          ? 'enabled'
          : // Waiting on a decision is not the same as switched off, and reading as "disabled"
            // is what made a dropped-in plugin look broken: the user installed it and the
            // screen appeared to have ignored them. `neutral` says "your move".
            plugin.awaitingConsent
            ? 'neutral'
            : 'disabled'
  const label = plugin.displayName?.trim() || plugin.name
  const metadata: SettingRegistryMetaItem[] = [
    ...(builtin ? [{ label: 'Built-in', title: 'Ships with Localix and updates with it' }] : []),
    { label: `v${plugin.version}` },
    ...(mod
      ? [
          {
            label: 'Mod',
            title: 'Has a hooks module: it runs with each conversation, as in Claude Code',
          },
        ]
      : []),
    ...(builtin ? [] : [{ label: projName }]),
    ...(plugin.importedFrom === 'claude-code'
      ? [{ label: 'from Claude Code', title: 'Installed by Claude Code and read in place' }]
      : []),
    ...(plugin.awaitingConsent
      ? [
          {
            label: 'awaiting your yes',
            title: 'Installed from outside Localix, so nothing of it runs until you allow it',
          },
        ]
      : []),
    ...chips.map((label) => ({ label })),
  ]

  return (
    <SettingRegistryRow
      state={state}
      anchor={pluginSettingsAnchor(plugin.name)}
      uiTargetUri={pluginSettingsUri(plugin.name, plugin.projectId)}
      busyLabel={busyLabel ?? undefined}
      toggle={
        <Switch
          checked={plugin.enabled}
          disabled={busy}
          onChange={onToggle}
          aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
        />
      }
      actions={
        <>
          {offered && onUpdate && (
            <Button
              variant="ghost"
              size="default"
              onClick={onUpdate}
              disabled={busy || updating !== null}
              aria-busy={updating !== null || undefined}
            >
              Update now
            </Button>
          )}
          {configurable && (
            <Button variant="ghost" size="default" onClick={onToggleConfig} disabled={busy}>
              Configure
            </Button>
          )}
          {!builtin && (
            <Button variant="destructive" size="default" onClick={onRemove} disabled={busy}>
              Remove
            </Button>
          )}
        </>
      }
      header={
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex min-w-0 max-w-full flex-[1_1_12rem] items-baseline gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                {label}
              </span>
              {label !== plugin.name && (
                <code className="min-w-0 truncate text-2xs text-text-faint">{plugin.name}</code>
              )}
            </div>
          </div>
          <SettingRegistryMeta items={metadata} />
          {plugin.description && (
            <p className="mt-1 truncate text-xs text-text-faint" title={plugin.description}>
              {plugin.description}
            </p>
          )}
          {mod?.status === 'running' && (
            <p className="mt-1 truncate text-xs text-text-faint" title={modLine(mod)}>
              {modLine(mod)}
            </p>
          )}
          <p className="mt-1 break-all text-xs text-text-faint" title={plugin.dir}>
            Path: <code className="font-mono text-text-soft">{plugin.dir}</code>
          </p>
          {offered && (
            <p className="mt-1 text-xs text-text-soft" role="status">
              {updating
                ? `${UPDATE_PHASE_LABEL[updating]} ${offered.to}…`
                : updateJob?.phase === 'failed'
                  ? `Update failed: ${updateJob.error ?? 'unknown error'}`
                  : `Update available: ${offered.from} → ${offered.to}`}
            </p>
          )}
        </>
      }
    >
      <SettingProblems
        className="mt-2 ml-5"
        subject={label}
        errors={errors}
        warnings={warnings}
        // Findings about the record: a plugin row never "shows the last valid version".
        consequence="none"
      />
      {configOpen && plugin.config.length > 0 && (
        <SettingsConfigForm fields={plugin.config} busy={busy} onSave={onSaveConfig} />
      )}
    </SettingRegistryRow>
  )
}
