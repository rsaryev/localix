import { useState } from 'react'
import type { MiniAppRecord, Project } from '@/shared/api/contracts'
import { useMiniApps } from '../model/useMiniApps'
import { SettingProblems } from './settingRegistry'
import { SettingsSection } from './SettingsScaffold'
import { AttentionRollup } from './AttentionRollup'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { MiniAppRow } from './capabilities/MiniAppRow'
import { Button } from '@localixai/kit/button'
import { openMiniAppStore, openStore } from '@/shared/lib/openStore'

interface MiniAppsSettingsProps {
  /** '' = no project; otherwise a project id: which installed mini apps are listed. */
  scope: string
  /** The agent whose rules a switch on this tab writes; `''` is the one that always exists. */
  agentScope?: string
  projects: Project[]
}

/** Settings → Capabilities → Mini apps: the installed apps, their switches and settings. */
export function MiniAppsSettings({ scope, agentScope = '', projects }: MiniAppsSettingsProps) {
  const { miniApps, loading, error, busy, busyLabel, refresh, toggle, remove, saveConfig } =
    useMiniApps(scope, agentScope)
  const [configFor, setConfigFor] = useState<string | null>(null)

  const handleSaveConfig = async (
    app: MiniAppRecord,
    values: Record<string, string | number | boolean>,
  ) => {
    if (await saveConfig(app, values)) setConfigFor(null)
  }

  return (
    <div className="w-full space-y-8">
      <SettingsSection
        title="Mini apps"
        description="Apps with their own screens and tools. Whether one runs applies to the selected agent; its settings are shared where it is installed."
        actions={
          <AttentionRollup
            errorCount={miniApps.filter((app) => app.error).length}
            warningCount={0}
          />
        }
      >
        <SettingProblems
          className="mb-3"
          subject="Mini apps"
          errors={error ? [error] : []}
          onRetry={refresh}
        />
        <CapabilityRegistryBody
          count={miniApps.length}
          loading={loading}
          error={error}
          empty={
            <>
              No mini apps here yet. Describe one in chat with <code>/mini-app create</code>, or add
              a folder holding a <code>mini-app.json</code> to <code>~/.localix/mini-apps</code>.
            </>
          }
        >
          {miniApps.map((app) => (
            <MiniAppRow
              key={`${app.projectId}:${app.name}`}
              app={app}
              projects={projects}
              busy={busy === app.name}
              busyLabel={busy === app.name ? busyLabel : null}
              configOpen={configFor === app.name}
              onToggle={() => void toggle(app)}
              onRemove={() => void remove(app)}
              onToggleConfig={() => setConfigFor((cur) => (cur === app.name ? null : app.name))}
              onSaveConfig={(values) => void handleSaveConfig(app, values)}
            />
          ))}
        </CapabilityRegistryBody>
      </SettingsSection>

      <SettingsSection
        title="Store"
        description="Add mini apps, update them and choose the catalogs they come from in the Store."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="field" onClick={openMiniAppStore}>
            Open the Store
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openStore({ shelf: 'sources' })}>
            Catalogs
          </Button>
        </div>
      </SettingsSection>
    </div>
  )
}
