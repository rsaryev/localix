import { MarketplacesPanel } from './MarketplacesPanel'
import { useInstallForm } from '../model/useInstallForm'
import { InstallForm } from './InstallForm'
import { backendClient } from '@/shared/api/client'
import { usePlugins } from '../model/usePlugins'
import type { Project } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { SettingProblems } from './settingRegistry'
import { SettingsSection } from './SettingsScaffold'
import { AttentionRollup } from './AttentionRollup'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { PluginRow } from './capabilities/PluginRow'
import { PluginGroups } from './capabilities/PluginGroups'
import { usePluginUpdates } from '../model/usePluginUpdates'
import { useModSummaries } from '../model/useModSummaries'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { refetchActiveMiniAppContrib } from '@/shared/contrib/enabledMiniApps'

interface PluginsSettingsProps {
  /** '' = global; otherwise a project id. Drives both the list and install scope. */
  scope: string
  /** The agent whose rules a switch on this tab writes; `''` is the one that always exists. */
  agentScope?: string
  projects: Project[]
}

export function PluginsSettings({ scope, agentScope = '', projects }: PluginsSettingsProps) {
  const { plugins, loading, error, busy, busyLabel, refresh, toggle, remove } = usePlugins(
    scope,
    agentScope,
  )
  const pluginUpdates = usePluginUpdates()
  const mods = useModSummaries()

  // Install panel
  const form = useInstallForm({
    install: (src, enable) =>
      trackCapabilityWrite(scope || null, async () => {
        const plugin = await backendClient.installPlugin(src, {
          projectId: scope || null,
          enable,
        })
        await refetchActiveMiniAppContrib()
        return plugin
      }),
    refresh,
    defaultEnable: true,
  })

  // Glanceable roll-up: how many plugins have load/validation errors vs. only warnings.
  const errorCount = plugins.filter((p) => p.error || (p.validation?.errors.length ?? 0) > 0).length
  const warningCount = plugins.filter(
    (p) =>
      !p.error &&
      !p.validation?.errors.length &&
      ((p.validation?.warnings.length ?? 0) > 0 || mods.get(p.name)?.status === 'failed'),
  ).length
  const registryAuthoritative = plugins.length > 0 || (!loading && !error)

  return (
    <div className="w-full space-y-8">
      <SettingsSection
        title="Plugins"
        description="Availability applies to the selected agent. Installation and configuration are shared within their installation scope."
        actions={
          <>
            <AttentionRollup errorCount={errorCount} warningCount={warningCount} />
            <Button size="xl" variant="mono" onClick={form.open}>
              Install plugin
            </Button>
          </>
        }
      >
        <InstallForm
          form={form}
          placeholder="/path/to/plugin  ·  https://github.com/owner/repo  ·  owner/repo"
          enableLabel="Enable after install"
          subject="plugin"
          destination={
            scope
              ? `${projects.find((project) => project.id === scope)?.name ?? 'this project'} — it ships with the repository`
              : 'your personal plugins — available in every project'
          }
        />

        <SettingProblems
          className="mb-3"
          subject="Plugins"
          errors={error && !form.installing ? [error] : []}
          onRetry={refresh}
        />

        <CapabilityRegistryBody
          count={plugins.length}
          loading={loading}
          error={error}
          list={false}
          empty={
            <>
              No plugins here yet. Install one with Install plugin, or drop a plugin folder (with{' '}
              <code>.claude-plugin/plugin.json</code>, as in Claude Code) into{' '}
              <code>~/.localix/plugins</code>.
            </>
          }
        >
          <PluginGroups
            plugins={plugins}
            updates={pluginUpdates.updates}
            renderRow={(p, update) => (
              <PluginRow
                key={`${p.projectId}:${p.name}`}
                plugin={p}
                projects={projects}
                mod={mods.get(p.name)}
                busy={busy === p.name}
                busyLabel={busy === p.name ? busyLabel : null}
                update={update}
                updateJob={update ? pluginUpdates.jobFor(update.id) : undefined}
                onToggle={() => void toggle(p)}
                onRemove={() => void remove(p)}
                onUpdate={update ? () => void pluginUpdates.updateNow(update.id) : undefined}
              />
            )}
          />
        </CapabilityRegistryBody>
      </SettingsSection>

      {/* Marketplaces use the same sidecar. Mount them only after the primary
          registry is authoritative so one outage produces one retry line. Keep
          them mounted through later refreshes once real plugin data exists. */}
      {!scope && registryAuthoritative && <MarketplacesPanel onChanged={refresh} />}
    </div>
  )
}
