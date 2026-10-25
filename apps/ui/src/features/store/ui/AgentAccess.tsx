import { useState } from 'react'
import type { Listing } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { Skeleton } from '@localixai/kit/skeleton'
import { Switch } from '@localixai/kit/switch'
import { agentScopeValue } from '@/shared/api/capabilityScope'
import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange, type CapabilityKind } from '@/shared/contrib/capabilityRules'
import { useCapabilitySnapshot } from '@/shared/contrib/useCapabilitySnapshot'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { openStore } from '@/shared/lib/openStore'

/** One thing the agent may or may not use, and the Store page it has, when it has one. */
interface AccessRow {
  key: string
  kind: CapabilityKind
  /** What the rule names: `tool:bash` writes `bash`. */
  name: string
  label: string
  detail?: string
  enabled: boolean
  /** The switch would lie: the owner is off, or the run shape does not carry it. */
  locked?: string
  page?: { kind: string; id: string }
}

interface AccessGroup {
  title: string
  rows: AccessRow[]
}

/** What the snapshot says about an agent, as groups of rows: the server's answer, not ours. */
export function accessGroups(snapshot: CapabilitySnapshot): AccessGroup[] {
  const denied = new Map(snapshot.tools.disabled.map((entry) => [entry.name, entry]))
  return [
    {
      title: 'Tools',
      rows: snapshot.tools.catalog.map((tool) => {
        const denial = denied.get(tool.name)
        return {
          key: `tool:${tool.name}`,
          kind: 'tool' as const,
          name: tool.name,
          label: tool.label,
          detail: tool.description,
          enabled: !denial,
          ...(denial && denial.reason !== 'settings'
            ? { locked: 'Off for a reason a switch cannot lift' }
            : {}),
        }
      }),
    },
    {
      title: 'Skills',
      rows: snapshot.skills.map((skill) => ({
        key: `skill:${skill.id}`,
        kind: 'skill' as const,
        name: skill.name,
        label: `/${skill.name}`,
        detail: skill.description,
        enabled: skill.enabled,
        ...(skill.id.startsWith('plugin:')
          ? {}
          : {
              page: {
                kind: 'skill',
                id: `${skill.scope === 'project' ? 'project' : 'user'}:${skill.name}`,
              },
            }),
      })),
    },
    {
      title: 'MCP servers',
      rows: snapshot.mcp.map((server) => ({
        key: `mcp:${server.id}`,
        kind: 'mcp' as const,
        name: server.name,
        label: server.name,
        enabled: server.enabled,
        page: {
          kind: 'mcp-server',
          id: server.projectId ? `project:${server.name}` : server.name,
        },
      })),
    },
    {
      title: 'Plugins',
      rows: snapshot.plugins.map((plugin) => ({
        key: `plugin:${plugin.projectId}:${plugin.name}`,
        kind: 'plugin' as const,
        name: plugin.name,
        label: plugin.displayName ?? plugin.name,
        detail: plugin.description,
        enabled: plugin.enabled,
        ...(plugin.source.includes('@') ? { page: { kind: 'plugin', id: plugin.source } } : {}),
      })),
    },
    {
      title: 'Mini apps',
      rows: snapshot.miniApps.map((app) => ({
        key: `mini-app:${app.name}`,
        kind: 'mini-app' as const,
        name: app.name,
        label: app.displayName ?? app.name,
        detail: app.description,
        enabled: app.enabled,
        page: { kind: 'mini-app', id: app.name },
      })),
    },
  ].filter((group) => group.rows.length > 0)
}

/**
 * AN AGENT'S ACCESS TAB (`docs/internals/agents-claude-code.md`, "Agent page"): per-agent allow
 * switches for tools, skills, MCP servers, plugins and mini apps, each row linking to the item's own
 * Store page. A switch writes one `agent`-scoped rule and nothing else — it can narrow what the
 * installation and the project allow, never widen it — and the rows are the server's answer for
 * that agent, so this page cannot disagree with a run.
 */
export function AgentAccess({ listing }: { listing: Listing }) {
  const scope = agentScopeValue(listing.ref.id)
  const { snapshot, loading, error, refresh } = useCapabilitySnapshot(scope)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (row: AccessRow) => {
    setBusy(row.key)
    setProblem(null)
    try {
      await applyCapabilityRules(scope, [availabilityChange(row.kind, row.name, !row.enabled)])
    } catch (failure) {
      setProblem(inlineFailure(failure, `Could not change ${row.label}.`))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  if (!snapshot)
    return error ? (
      <p role="alert" className="text-xs text-status-error">
        Its access could not be read.
      </p>
    ) : (
      <div aria-busy={loading} className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )

  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      <p className="text-xs text-text-soft">
        What this agent may use. A switch here narrows what you and the project allow; it never
        widens it.
      </p>
      {problem && (
        <p role="alert" className="text-xs text-status-error">
          {problem}
        </p>
      )}
      {accessGroups(snapshot).map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-text-faint">{group.title}</h3>
          <ul className="flex flex-col">
            {group.rows.map((row) => (
              <li
                key={row.key}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground">{row.label}</span>
                  {(row.locked ?? row.detail) && (
                    <span className="truncate text-xs text-text-soft">
                      {row.locked ?? row.detail}
                    </span>
                  )}
                </span>
                {row.page && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openStore({ ref: row.page })}
                    aria-label={`Open ${row.label} in the Store`}
                  >
                    Open
                  </Button>
                )}
                <Switch
                  checked={row.enabled}
                  disabled={busy === row.key || Boolean(row.locked)}
                  onChange={() => void toggle(row)}
                  aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.label} for this agent`}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
