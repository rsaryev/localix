import { useState } from 'react'

import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import type { McpServerRecord, Project } from '@/shared/api/contracts'
import { useMcpServers } from '../model/useMcpServers'
import { useMcpServerForm } from '../model/useMcpServerForm'
import { Button } from '@localixai/kit/button'
import { SettingProblems } from './settingRegistry'
import { CapabilityIntro } from './capabilities/CapabilityIntro'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { McpServerForm } from './capabilities/McpServerForm'
import { McpServerRow } from './capabilities/McpServerRow'

interface McpSettingsProps {
  /** '' = global; otherwise a project id. Drives both the list and the default scope for new servers. */
  scope: string
  /** The agent whose rules a switch on this tab writes; `''` is the one that always exists. */
  agentScope?: string
  projects: Project[]
}

export function McpSettings({ scope, agentScope = '', projects }: McpSettingsProps) {
  const {
    servers,
    loading,
    error,
    status,
    mutations,
    refresh,
    probeServer,
    toggleEnabled,
    setToolEnabled,
    remove,
    signIn,
    signOut,
  } = useMcpServers(scope, agentScope)
  // Glanceable roll-up: enabled servers whose live connection probe failed (buried
  // per-card otherwise). Resolves reactively as probes come back.
  const failedCount = servers.filter((s) => {
    const st = status[s.id]
    return s.enabled && st && st !== 'loading' && !st.ok
  }).length
  const form = useMcpServerForm({ scope, refresh })
  const [confirmDelete, setConfirmDelete] = useState<McpServerRecord | null>(null)

  return (
    <div className="w-full">
      <CapabilityIntro
        attention={{ errorCount: failedCount, warningCount: 0 }}
        action={
          <Button variant="mono" onClick={form.startAdd}>
            Add server
          </Button>
        }
      />

      <McpServerForm form={form} scope={scope} projects={projects} />

      {/* List-level errors (load / toggle / approval failures) are surfaced here so
          they're visible with the add/edit form closed too — not only inside it. */}
      <SettingProblems
        className="mb-3"
        subject="MCP servers"
        errors={error && !form.adding ? [error] : []}
        onRetry={refresh}
      />

      <CapabilityRegistryBody
        count={servers.length}
        loading={loading}
        error={error}
        empty={
          <>
            No MCP servers here yet. Add one with Add server: fill in the form, paste a{' '}
            <code>mcpServers</code> JSON blob, or drop in a one-line <code>npx</code> command.
          </>
        }
      >
        {servers.map((s) => (
          <McpServerRow
            key={s.id}
            server={s}
            projects={projects}
            status={status[s.id]}
            mutationLabel={mutations[s.id]}
            onToggleEnabled={() => void toggleEnabled(s)}
            onToolEnabled={(toolName, enabled) => void setToolEnabled(s, toolName, enabled)}
            onProbe={() => void probeServer(s)}
            onEdit={() => form.startEdit(s)}
            onDelete={() => setConfirmDelete(s)}
            onSignIn={() => void signIn(s)}
            onSignOut={() => void signOut(s)}
          />
        ))}
      </CapabilityRegistryBody>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.name}"?`}
        description="This removes the MCP server and its tools. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) void remove(target)
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  )
}
