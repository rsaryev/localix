import type { McpServerRecord, Project } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { openStore } from '@/shared/lib/openStore'
import { useMcpServers } from '../model/useMcpServers'
import { SettingProblems } from './settingRegistry'
import { SettingsSection } from './SettingsScaffold'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { McpServerRow } from './capabilities/McpServerRow'

interface McpSettingsProps {
  /** '' = global; otherwise a project id: which servers are listed. */
  scope: string
  /** The agent whose rules a switch on this tab writes; `''` is the one that always exists. */
  agentScope?: string
  projects: Project[]
}

/** A server's page in the Store: a project's own has its own id. */
const openServer = (server: McpServerRecord) =>
  openStore({
    ref: {
      kind: 'mcp-server',
      id: server.projectId ? `project:${server.name}` : server.name,
    },
  })

/** Settings → Capabilities → MCP: whether the agent may reach each server. Servers live in the Store. */
export function McpSettings({ scope, agentScope = '', projects }: McpSettingsProps) {
  const { servers, loading, error, busy, refresh, toggleEnabled } = useMcpServers(scope, agentScope)

  return (
    <div className="w-full space-y-8">
      <SettingsSection
        title="MCP servers"
        description="Whether the selected agent may reach each server. A server is added, configured, tested and removed on its Store page."
        actions={
          <Button size="xl" variant="mono" onClick={() => openStore({ shelf: 'yours' })}>
            Open in the Store
          </Button>
        }
      >
        <SettingProblems
          className="mb-3"
          subject="MCP servers"
          errors={error ? [error] : []}
          onRetry={refresh}
        />
        <CapabilityRegistryBody
          count={servers.length}
          loading={loading}
          error={error}
          empty={
            <>
              No MCP servers here yet. Add one from Library → Yours in the Store, with Add MCP
              server.
            </>
          }
        >
          {servers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              projects={projects}
              busy={busy === server.id}
              onToggleEnabled={() => void toggleEnabled(server)}
              onOpen={() => openServer(server)}
            />
          ))}
        </CapabilityRegistryBody>
      </SettingsSection>
    </div>
  )
}
