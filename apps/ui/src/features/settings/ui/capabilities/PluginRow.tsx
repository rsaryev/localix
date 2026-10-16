import { isWorkbenchPlugin } from '@localixai/plugin-sdk/manifest-primitives'
import { pluginCapabilityLabels, pluginIssueSummary } from '@localixai/api/plugin-presentation'
import type { PluginRecord, Project } from '@/shared/api/contracts'
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
import { pluginLabel } from '@localixai/plugin-sdk/manifest-label'

/**
 * One installed plugin as a registry row: what it provides, where it came from,
 * its enable switch, and its config form when expanded.
 *
 * The metadata list is the reason this is its own file. A plugin's chips answer
 * "what does enabling this run?" — in-process native code, workbench surfaces,
 * a migrated third-party bundle — and that vocabulary grows on its own schedule,
 * independent of how the list is loaded or refreshed.
 */
export function PluginRow({
  plugin,
  projects,
  busy,
  busyLabel,
  configOpen,
  onToggle,
  onRemove,
  onToggleConfig,
  onSaveConfig,
}: {
  plugin: PluginRecord
  projects: Project[]
  busy: boolean
  busyLabel: string | null
  configOpen: boolean
  onToggle: () => void
  onRemove: () => void
  onToggleConfig: () => void
  onSaveConfig: (values: Record<string, string | number | boolean>) => void
}) {
  const configurable = plugin.config.length > 0
  const chips = pluginCapabilityLabels(plugin.provides, plugin.enabled)

  const projName = projectScopeLabel(projects, plugin.projectId)
  // Static validation from the loader (same data `/plugin list` shows in chat).
  const { errors, warnings } = pluginIssueSummary(plugin)
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
  const metadata: SettingRegistryMetaItem[] = [
    { label: `v${plugin.version}` },
    { label: projName },
    plugin.importedFrom === 'claude-code'
      ? {
          label: 'imported',
          title: `Imported from Claude Code${plugin.migratedFrom ? ` (${plugin.migratedFrom})` : ''}`,
        }
      : {
          label: plugin.migratedFrom ? 'migrated' : 'native',
          title: plugin.migratedFrom
            ? `Migrated from ${plugin.migratedFrom}`
            : 'Written natively for Localix',
        },
    ...(isWorkbenchPlugin(plugin.surfaces)
      ? [
          {
            label: 'workbench',
            title: 'Extends the IDE workbench with panels, tabs, or editors',
          },
        ]
      : []),
    ...(plugin.provides.hasNativeTools
      ? [
          {
            label: 'in-process',
            tone: 'warning' as const,
            title: 'Runs in-process JavaScript when enabled',
          },
        ]
      : []),
    ...(plugin.awaitingConsent
      ? [
          {
            label: 'awaiting your yes',
            title: plugin.bundled
              ? 'Ships with Localix but loads code, so it waits for you'
              : 'Came from outside Localix, so its code has not been loaded',
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
          {configurable && (
            <Button variant="ghost" size="default" onClick={onToggleConfig} disabled={busy}>
              Configure
            </Button>
          )}
          {!plugin.bundled && (
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
                {pluginLabel(plugin)}
              </span>
              {pluginLabel(plugin) !== plugin.name && (
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
          <p className="mt-1 break-all text-xs text-text-faint" title={plugin.dir}>
            Path: <code className="font-mono text-text-soft">{plugin.dir}</code>
          </p>
        </>
      }
    >
      <SettingProblems
        className="mt-2 ml-5"
        subject={pluginLabel(plugin)}
        errors={errors}
        warnings={warnings}
        // Findings about the record: a plugin row never "shows the last valid version".
        consequence="none"
      />
      {plugin.enabled && plugin.provides.tools.length > 0 && (
        <p
          className="mt-2 ml-5 truncate text-xs text-text-faint"
          title={plugin.provides.tools.map((tool) => tool.name).join(', ')}
        >
          Tools:{' '}
          <span className="font-mono text-text-soft">
            {plugin.provides.tools.map((tool) => tool.name).join(', ')}
          </span>
        </p>
      )}

      {configOpen && plugin.config.length > 0 && (
        <SettingsConfigForm fields={plugin.config} busy={busy} onSave={onSaveConfig} />
      )}
    </SettingRegistryRow>
  )
}
