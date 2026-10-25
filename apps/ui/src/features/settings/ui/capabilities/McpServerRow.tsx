import type { McpServerRecord, Project } from '@/shared/api/contracts'
import { projectScopeLabel } from '@/shared/lib/projectScope'
import { Button } from '@localixai/kit/button'
import { Switch } from '@localixai/kit/switch'
import { settingsEntityUiUri } from '@localixai/mini-app-sdk/navigation'
import { SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'

/**
 * One MCP server as a registry row: whether the agent may reach it, and the way to its Store page,
 * where it is configured, tested and removed. What it connects to is shown by its kind and scope,
 * never by what it holds.
 */
export function McpServerRow({
  server,
  projects,
  busy,
  onToggleEnabled,
  onOpen,
}: {
  server: McpServerRecord
  projects: Project[]
  busy: boolean
  onToggleEnabled: () => void
  onOpen: () => void
}) {
  return (
    <SettingRegistryRow
      uiTargetUri={settingsEntityUiUri('mcp', 'mcp', server.name, server.projectId)}
      state={server.enabled ? 'enabled' : 'disabled'}
      busyLabel={busy ? `Switching ${server.name}` : undefined}
      header={
        <>
          <div className="min-w-0">
            <code
              className="block min-w-0 max-w-full truncate text-sm font-semibold text-foreground"
              title={server.name}
            >
              {server.name}
            </code>
            <SettingRegistryMeta
              items={[
                { label: server.transport },
                { label: projectScopeLabel(projects, server.projectId) },
                ...(server.oauthStatus === 'authenticated'
                  ? [{ label: 'OAuth', title: 'Signed in with OAuth' }]
                  : []),
              ]}
            />
          </div>
          {server.description && (
            <p className="mt-1 truncate text-xs text-text-faint" title={server.description}>
              {server.description}
            </p>
          )}
        </>
      }
      toggle={
        <Switch
          checked={server.enabled}
          disabled={busy}
          onChange={onToggleEnabled}
          aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
        />
      }
      actions={
        <Button variant="ghost" size="default" onClick={onOpen}>
          Settings
        </Button>
      }
    />
  )
}
