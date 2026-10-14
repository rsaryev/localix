import type { AgentSummary, Project } from '@/shared/api/contracts'
import { projectScopeLabel } from '@/shared/lib/projectScope'
import { SquareArrowOutUpRight } from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { IconButton } from '@localixai/kit/icon-button'
import { Switch } from '@localixai/kit/switch'
import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'
import { agentPolicy } from '@localixai/api/agent-policy'
import { SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'

/**
 * Why an always-on agent's toggle is dead rather than refusing.
 *
 * The server refuses the write (`agent_always_enabled`), and letting the row ASK meant the
 * answer arrived as a page-level error line — a control that looks live, a click that does
 * nothing, and a banner that reflows the list to say so. The rule is the same table the
 * server guards with, so the row can state it instead of discovering it.
 */
const ALWAYS_ON_REASON =
  'The app runs on this agent, so it cannot be switched off. Duplicate it to get one you own.'

interface AgentRowProps {
  agent: AgentSummary
  projects: Project[]
  busyLabel: string | undefined
  actionsDisabled: boolean
  onToggle: () => void
  /**
   * The row's ONE action: open this agent's profile, in the tab every other mention of it
   * opens too. Duplicate, delete and reset live on that profile — they act on the whole
   * record, and a row that offered them put three verbs of different weight, one of them
   * destructive, a pixel apart on a list you scan.
   */
  onOpen: () => void
}

/**
 * One managed agent as a registry row: identity, where it came from, what it runs on.
 *
 * Three provenances read differently and the row says which: `system` is served from
 * code and can only be switched off; `customized` is a system agent under the user's
 * override (Reset brings the shipped one back); everything else is the user's own file,
 * possibly imported, and can be deleted.
 */
export function AgentRow({
  agent,
  projects,
  busyLabel,
  actionsDisabled,
  onToggle,
  onOpen,
}: AgentRowProps) {
  const r = agent.record
  const alwaysOn = !agentPolicy(agent).disable
  const unavailable =
    agent.unavailableReason === 'source_disabled'
      ? 'Enable the owning extension before using this agent.'
      : agent.unavailableReason === 'policy_pending'
        ? 'Review the current imported policy before this agent can run.'
        : undefined
  const imported = agent.source.startsWith('imported:')
  const system = agent.source === 'builtin'
  const customized = agent.builtin && !system
  const model = r.modelPreference?.model
    ? `${r.modelPreference?.provider ? `${r.modelPreference?.provider} · ` : ''}${r.modelPreference?.model}`
    : null

  return (
    <SettingRegistryRow
      uiTargetUri={settingsEntityUiUri('agents', 'agent', r.id, agent.projectId)}
      state={agent.enabled ? 'enabled' : 'disabled'}
      busyLabel={busyLabel}
      leading={<MonogramAvatar identity={r.handle} label={r.label} />}
      toggle={
        // The title rides the wrapper, not the input: a disabled control gets no pointer
        // events, so a tooltip on it would never be read.
        <span title={alwaysOn ? ALWAYS_ON_REASON : unavailable} className="inline-flex">
          <Switch
            checked={agent.enabled}
            disabled={actionsDisabled || alwaysOn || Boolean(unavailable)}
            onChange={onToggle}
            aria-label={
              alwaysOn
                ? `${r.handle} is always enabled`
                : `${agent.enabled ? 'Disable' : 'Enable'} ${r.handle}`
            }
          />
        </span>
      }
      actions={
        <IconButton
          size="md"
          onClick={onOpen}
          disabled={actionsDisabled}
          aria-label={`Open ${r.label || r.handle}`}
          tooltip="Open profile"
        >
          <SquareArrowOutUpRight className="size-3.5" />
        </IconButton>
      }
      header={
        <>
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-foreground" title={r.handle}>
              {r.label || r.handle}
            </p>
            {r.label && <code className="shrink-0 text-2xs text-text-soft">{r.handle}</code>}
            {agent.invocations.chat === 'allow' && <Badge>chat</Badge>}
            {system && <Badge>system</Badge>}
            {customized && (
              <Badge title="A system agent with your changes on top">customized</Badge>
            )}
          </div>
          <SettingRegistryMeta
            items={[
              { label: projectScopeLabel(projects, agent.projectId) },
              ...(model ? [{ label: model }] : []),
              ...(r.context?.preloadSkills?.length
                ? [{ label: `${r.context?.preloadSkills.length} skills` }]
                : []),
              ...(imported ? [{ label: agent.registration?.sourceName ?? agent.source }] : []),
              ...(unavailable ? [{ label: unavailable }] : []),
            ]}
          />
          <p
            className="mt-1 truncate text-xs text-text-faint"
            title={r.description || r.instructions}
          >
            {r.description || r.instructions.trim() || '—'}
          </p>
        </>
      }
    />
  )
}

function Badge({ children, title }: { children: string; title?: string }) {
  return (
    <span
      title={title}
      className="shrink-0 rounded-sm border border-border-soft px-1 text-2xs uppercase tracking-wide text-text-soft"
    >
      {children}
    </span>
  )
}
