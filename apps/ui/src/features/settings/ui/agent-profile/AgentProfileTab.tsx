import { useEffect, useRef, useState } from 'react'
import { agentPolicy } from '@localixai/api/agent-policy'
import type { Project } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { inspector } from '@/shared/lib/inspectorBus'
import { useAgents } from '../../model/useAgents'
import {
  closeAgentProfile,
  newAgentTabId,
  openAgentProfile,
  type AgentProfilePayload,
} from '../../model/agentProfileTab'
import { SettingProblems } from '../settingRegistry'
import { SettingsPageHeader } from '../SettingsScaffold'
import { SettingsNavigation } from '../SettingsNavigation'
import { SettingsWorkspace } from '../SettingsWorkspace'
import { AgentEditor } from '../capabilities/agent-editor/AgentEditor'
import {
  AGENT_PROFILE_TABS,
  AgentCapabilityPanel,
  type AgentProfileTabId,
} from './AgentCapabilityPanel'
import { agentProvenance } from './agentProvenance'

/**
 * One agent's profile, as a workspace tab: who it is, and what it may use.
 *
 * The tab is the SUBJECT, not a dialog about it — it is opened from a mention, an author line, a
 * chat heading and the registry alike, it survives a reload, and it can sit beside the
 * conversation the agent is in. That is why Delete lives here rather than on the registry row:
 * it acts on the agent, and the agent is what this screen is.
 *
 * Its two halves are its two kinds of tab. `Definition` is what the record SAYS — persona,
 * model, instructions, limits — saved with a button, because a half-typed prompt must not be
 * what the next run uses. The capability tabs are what the record MAY USE, and each switch there
 * writes one rule immediately, because a ceiling is a decision, not a draft.
 *
 * It reads the registry of its own scope rather than fetching the record alone: that document is
 * already loaded and shared with every other capability surface, and every write offered here is
 * a registry write.
 */
export function AgentProfileTab({
  agentId,
  projectId,
  initialHandle,
  section,
  sectionRequestId,
}: AgentProfilePayload) {
  const { agents, loading, error, busy, refresh, create, update, remove, reset } =
    useAgents(projectId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState<AgentProfileTabId>(section ?? 'definition')
  useEffect(() => {
    if (section) setTab(section)
  }, [section, sectionRequestId])
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [tab])
  const projects = useProjects()
  const draft = agentId === ''
  // Matched by id OR handle, because a link does not always carry an id. A mention in a message
  // is written `@handle`, and a chat group is keyed by handle too — the id is only known when
  // the capability document that was loaded happens to list that agent. Failing the id match
  // and stopping is how a click from the session list landed on "no longer in the registry"
  // while the agent was sitting in the list right below it.
  const agent = draft
    ? undefined
    : agents.find(
        (candidate) => candidate.record.id === agentId || candidate.record.handle === agentId,
      )

  const closeSelf = () =>
    draft
      ? inspector.closeWorkItems(newAgentTabId(projectId))
      : closeAgentProfile(agentId, projectId)

  // The registry has answered and this record is not in it: the tab outlived what it was about
  // (deleted elsewhere, or a link to a project agent opened against another scope). Say so
  // instead of rendering an empty form that would create a second record when saved.
  if (!draft && !agent) {
    return (
      <div className="h-full min-w-0 overflow-y-auto px-4 py-5" data-ui-scroll-container>
        <SettingProblems subject="Agent" errors={error ? [error] : []} onRetry={refresh} />
        {loading ? (
          <LoadingHint>Loading the agent…</LoadingHint>
        ) : (
          <EmptyHint>
            This agent is no longer in {projectId ? 'this project’s' : 'the'} registry. It may have
            been deleted, or it lives in another project.
          </EmptyHint>
        )}
      </div>
    )
  }

  const policy = agent ? agentPolicy(agent) : null
  const name = agent ? agent.record.label || agent.record.handle : 'New agent'

  return (
    <SettingsWorkspace
      contentRef={contentRef}
      navigation={
        agent && (
          <SettingsNavigation
            aria-label="Agent profile sections"
            pickerLabel="Agent section"
            sections={AGENT_PROFILE_TABS}
            active={tab}
            onChange={(id) => setTab(id as AgentProfileTabId)}
          />
        )
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        <SettingsPageHeader
          title={name}
          {...(agent ? { description: agentProvenance(agent) } : {})}
          actions={
            agent && policy?.delete ? (
              <Button
                size="xl"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={!!busy}
              >
                Delete
              </Button>
            ) : undefined
          }
        />

        {agent && tab !== 'definition' && (
          <AgentCapabilityPanel
            tab={tab}
            agentId={agent.record.id}
            projectId={agent.projectId}
            projects={projects}
          />
        )}
        {/* Keep the definition mounted so a visit to capabilities does not discard a draft. */}
        <div hidden={Boolean(agent && tab !== 'definition')}>
          <AgentEditor
            key={agent ? `${agent.projectId}:${agent.record.id}` : `new:${projectId}`}
            {...(agent ? { agent } : {})}
            busy={busy}
            initialHandle={initialHandle}
            onSave={async (input) => {
              if (agent) {
                await update(agent, input)
                return
              }
              // The draft becomes the record it just created: this tab closes and the saved
              // agent's own profile opens, so the id in the tab is the id on the server.
              const created = await create(input)
              inspector.closeWorkItems(newAgentTabId(projectId))
              openAgentProfile(
                created.record.id,
                created.projectId,
                created.record.label || created.record.handle,
              )
            }}
            onCancel={closeSelf}
            {...(agent?.builtin
              ? {
                  // A system agent can always ask for its shipped text back — the click only
                  // FILLS THE FIELDS. Dropping the override is the save, and there is only one
                  // to drop once the agent has been customized.
                  onLoadDefaults: () => backendClient.agentDefaults(agent.record.handle),
                  ...(agent.source !== 'builtin'
                    ? {
                        onDropOverride: async () => {
                          await reset(agent)
                        },
                      }
                    : {}),
                }
              : {})}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${name}"?`}
        description="This removes the agent’s definition file(s) from this scope. Sessions it ran stay in history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false)
          if (!agent) return
          // Close first: the profile of a record that is being removed has nothing left to show,
          // and a failed delete reports itself in the registry's own problem line.
          closeAgentProfile(agent.record.id, agent.projectId)
          void remove(agent)
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </SettingsWorkspace>
  )
}

/**
 * The project list the capability registries name scopes with (a skill's home, an MCP server's
 * install destination). Read once per visible profile — it is a short, rarely-changing list, and
 * a failure to read it costs the scope LABELS, never the lists themselves.
 */
function useProjects(): Project[] {
  const visible = useWorkItemVisible()
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    backendClient
      .listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [visible])
  return projects
}
