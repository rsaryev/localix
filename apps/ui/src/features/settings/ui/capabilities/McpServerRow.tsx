import type { McpServerRecord, Project } from '@/shared/api/contracts'
import { projectScopeLabel } from '@/shared/lib/projectScope'
import { Button } from '@localixai/kit/button'
import { Switch } from '@localixai/kit/switch'
import { settingsEntityUiUri } from '@localixai/mini-app-sdk/navigation'
import { SettingProblems, SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'
import { McpToolToggles } from '../McpToolToggles'
import { mcpRegistryState, mcpStatusLabel, shouldShowMcpSignIn, type McpStatus } from '../mcpStatus'

/**
 * One configured MCP server as a registry row.
 *
 * Its own file because a server row shows two things at once that arrive from
 * different places: what the user CONFIGURED (transport, scope, enable switch)
 * and what the live connection PROBE found (reachable, its tool list, its
 * failure). The probe resolves after the row is already on screen, so the
 * mapping from probe result to visible state is the part worth reading on its
 * own — `mcpStatus` holds the rules, this holds their arrangement.
 */
export function McpServerRow({
  server,
  projects,
  status,
  mutationLabel,
  onToggleEnabled,
  onToolEnabled,
  onProbe,
  onEdit,
  onDelete,
  onSignIn,
  onSignOut,
}: {
  server: McpServerRecord
  projects: Project[]
  /** Live probe result: undefined = not started, 'loading' = in flight. */
  status: McpStatus | undefined
  mutationLabel: string | undefined
  onToggleEnabled: () => void
  onToolEnabled: (toolName: string, enabled: boolean) => void
  onProbe: () => void
  onEdit: () => void
  onDelete: () => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const st = status
  const detail =
    server.transport === 'stdio'
      ? (server.config.command ?? []).join(' ')
      : (server.config.url ?? '')
  const toolCount = st && st !== 'loading' && st.ok ? st.tools.length : null
  const checking = server.enabled && (st === undefined || st === 'loading')
  const locked = Boolean(mutationLabel)

  return (
    <SettingRegistryRow
      uiTargetUri={settingsEntityUiUri('mcp', 'mcp', server.name, server.projectId)}
      state={mcpRegistryState(server.enabled, st)}
      busyLabel={mutationLabel ?? (checking ? `Checking connection to ${server.name}` : undefined)}
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
                { label: mcpStatusLabel(server.enabled, st, toolCount) },
              ]}
            />
          </div>
          <p
            className="mt-1 truncate font-mono text-xs text-text-faint"
            title={detail || server.description || undefined}
          >
            {detail || server.description || '—'}
          </p>
        </>
      }
      toggle={
        <>
          {shouldShowMcpSignIn(server, st) && (
            <Button variant="mono" title="Sign in with OAuth" onClick={onSignIn} disabled={locked}>
              Sign in
            </Button>
          )}
          <Switch
            checked={server.enabled}
            disabled={locked}
            onChange={onToggleEnabled}
            aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
          />
        </>
      }
      actions={
        <>
          {server.transport === 'http' && server.oauthStatus === 'authenticated' && (
            <Button
              variant="ghost"
              size="default"
              title="Forget stored OAuth tokens"
              onClick={onSignOut}
              disabled={locked}
            >
              Sign out
            </Button>
          )}
          <Button
            variant="ghost"
            size="default"
            title="Test connection"
            onClick={onProbe}
            disabled={locked || checking}
          >
            Test
          </Button>
          <Button variant="ghost" size="default" onClick={onEdit} disabled={locked}>
            Edit
          </Button>
          <Button variant="destructive" size="default" onClick={onDelete} disabled={locked}>
            Delete
          </Button>
        </>
      }
    >
      <SettingProblems
        className="mt-2 ml-5"
        subject={server.name}
        errors={st && st !== 'loading' && !st.ok ? [st.error ?? 'Connection failed'] : []}
      />
      {st && st !== 'loading' && st.ok && (
        <McpToolToggles
          serverName={server.name}
          availableTools={st.availableTools ?? st.tools}
          activeTools={st.tools}
          disabled={locked}
          onToolEnabled={onToolEnabled}
        />
      )}
    </SettingRegistryRow>
  )
}
