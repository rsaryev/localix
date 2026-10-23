import { useMemo } from 'react'
import { Boxes } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { StatCard, StatSection } from '@localixai/kit/stat'
import { StateNotice } from '@localixai/kit/state-notice'
import { StatusDot } from '@localixai/kit/status-dot'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { KANBAN_STATUS_DOT as STATUS_DOT } from '../model/kanbanStatus'
import { COLUMNS, DAY_MS } from './constants'

/** One clickable stats row — the full-bleed line of a divided list, with a keyboard focus edge. */
const STAT_ROW =
  'flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors focus-ring hover:bg-surface-hover'

/** Slim done/total progress bar, announced to assistive tech. */
function MiniProgress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? (done / total) * 100 : 0
  return (
    <ProgressBar
      value={pct}
      className="h-1.5 w-24 shrink-0"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${label}: ${done} of ${total} done`}
    />
  )
}

/** Client-side analytics over the (filtered) live cards of one chat's board. */
export function KanbanStats({
  tasks,
  now,
  onOpen,
}: {
  tasks: KanbanTask[]
  now: number
  onOpen: (id: string) => void
}) {
  // Derived together and memoized, so the arrays and counts feeding the cards and lists below
  // are not rebuilt on every unrelated re-render.
  const { leaf, epics, epicProgress, byStatus, done7d, done24h, active, agents, recent } =
    useMemo(() => {
      const leaf = tasks.filter((t) => t.kind !== 'epic')
      const epics = tasks.filter((t) => t.kind === 'epic')

      // Per-epic done/total in ONE pass over the leaf cards, not a re-filter per epic.
      const epicProgress = new Map<string, { done: number; total: number }>()
      for (const epic of epics) epicProgress.set(epic.id, { done: 0, total: 0 })
      for (const t of leaf) {
        const p = t.parentTaskId ? epicProgress.get(t.parentTaskId) : undefined
        if (!p) continue
        p.total += 1
        if (t.status === 'done') p.done += 1
      }
      const byStatus = (s: KanbanStatus) => leaf.filter((t) => t.status === s)
      const doneTasks = byStatus('done')
      const done7d = doneTasks.filter((t) => now - new Date(t.updatedAt).getTime() < 7 * DAY_MS)
      const done24h = doneTasks.filter((t) => now - new Date(t.updatedAt).getTime() < DAY_MS)
      const active = byStatus('in_progress').length

      // Per-agent tallies in ONE pass; unassigned cards are their own row.
      const tally = new Map<string, { agent: string; total: number; done: number }>()
      for (const t of leaf) {
        const agent = t.assignee ? `@${t.assignee}` : 'Unassigned'
        const acc = tally.get(agent) ?? { agent, total: 0, done: 0 }
        acc.total += 1
        if (t.status === 'done') acc.done += 1
        tally.set(agent, acc)
      }
      const agents = [...tally.values()].sort((a, b) => b.total - a.total)

      const recent = [...doneTasks]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)

      return { leaf, epics, epicProgress, byStatus, done7d, done24h, active, agents, recent }
    }, [tasks, now])

  if (leaf.length === 0) {
    return <StateNotice title="No tasks yet" body="Stats appear once the board has activity." />
  }

  return (
    // `@container`: every `@`-prefixed grid below reflows to the PANEL width, so the dashboard
    // fills the screen when maximized and stacks calmly when docked narrow.
    <div className="@container min-h-0 w-full flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
      <div className="flex w-full min-w-0 flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @4xl:grid-cols-6">
          {COLUMNS.map(({ status, title }) => (
            <StatCard
              key={status}
              label={title}
              value={byStatus(status).length}
              dot={STATUS_DOT[status]}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @4xl:grid-cols-6">
          <StatCard label="Done · 24h" value={done24h.length} />
          <StatCard label="Done · 7d" value={done7d.length} />
          <StatCard label="Active now" value={active} dot="bg-status-warning" title="in progress" />
        </div>

        <div className="grid grid-cols-1 gap-5 @4xl:grid-cols-2">
          {epics.length > 0 && (
            <StatSection title="Epics">
              <div className={DIVIDED_LIST}>
                {epics.map((epic) => {
                  const { done, total } = epicProgress.get(epic.id) ?? { done: 0, total: 0 }
                  return (
                    <button
                      key={epic.id}
                      type="button"
                      onClick={() => onOpen(epic.id)}
                      className={STAT_ROW}
                    >
                      <Boxes className="size-3.5 shrink-0 text-status-info" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {epic.title}
                      </span>
                      <MiniProgress done={done} total={total} label={epic.title} />
                      <span className="shrink-0 text-2xs tabular-nums text-text-faint">
                        {done}/{total}
                      </span>
                      <StatusDot className={STATUS_DOT[epic.status]} />
                    </button>
                  )
                })}
              </div>
            </StatSection>
          )}

          {agents.length > 0 && (
            <StatSection title="By agent">
              <div className={DIVIDED_LIST}>
                {agents.map(({ agent, total, done }) => (
                  <div key={agent} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{agent}</span>
                    <MiniProgress done={done} total={total} label={agent} />
                    <span className="shrink-0 text-2xs tabular-nums text-text-faint">
                      {done}/{total} done
                    </span>
                  </div>
                ))}
              </div>
            </StatSection>
          )}
        </div>

        {recent.length > 0 && (
          <StatSection title="Recently completed">
            <div className={cn(DIVIDED_LIST, 'grid grid-cols-1 @3xl:grid-cols-2 @3xl:divide-y-0')}>
              {recent.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="px-3 py-2.5 text-left outline-none transition-colors focus-ring hover:bg-surface-hover @3xl:border-b @3xl:border-border-faint"
                >
                  <div className="flex items-center gap-2">
                    <StatusDot className={STATUS_DOT.done} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {t.title}
                    </span>
                    <span className="shrink-0 text-2xs text-text-faint">
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </StatSection>
        )}
      </div>
    </div>
  )
}
