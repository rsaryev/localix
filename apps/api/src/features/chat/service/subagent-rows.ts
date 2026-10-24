import { claudeCodeHome } from '../../cc-settings/config-dir'
import { agentRoute } from '../../../contracts/session-route'
import { userHome } from '../../../lib/env'
import type { DelegatedRunSummary } from '../../agent-core/tools/delegate-control'
import { settingsCommandLine } from '../../cc-settings/settings-commands'
import { readSettingsFileLayers } from '../../cc-settings/settings-files'
import type { PluginCatalog } from '../../plugins/catalog'
import {
  activeSubagentStatusLine,
  runSubagentStatusLine,
  type SubagentTask,
} from '../../plugins/subagent-status-line'
import type { SessionRecord } from '../repository'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import {
  createSubagentRowsLive,
  type SubagentRowsComputed,
  type Timers,
} from './subagent-rows-live'

/** The most rows one refresh hands the command — far more than the panel shows at once. */
const MAX_TASKS = 20
/** The width a row gets: the panel's rows are about a terminal line wide. */
const COLUMNS = 80

/** A child's status in Claude Code's words: `running`, `completed`, `failed` or `killed`. */
function taskStatus(status: string): string {
  if (status === 'running' || status === 'failed') return status
  if (status === 'cancelled' || status === 'stopped' || status === 'interrupted') return 'killed'
  return 'completed'
}

/** The agent type a row names: a built-in's handle, a registry agent's id without its scope. */
const agentTypeOf = (agentId: string | undefined) => agentId?.replace(/^builtin:/, '') ?? 'agent'

/** The rows the command rewrote; `active` is false where no enabled plugin sets a status line. */
export interface SubagentRowsView {
  active: boolean
  rows: Array<{ id: string; content: string }>
}

export interface SubagentRowsDeps {
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  getSession: (userId: string, id: string) => Promise<SessionRecord | null>
  buildSessionPluginCatalog: (userId: string, session: SessionRecord) => Promise<PluginCatalog>
  resolveSessionWorkingDir: (userId: string, session: SessionRecord) => Promise<string>
  listDelegatedRuns: (userId: string, sessionId: string) => Promise<DelegatedRunSummary[]>
  streamRegistry: Pick<SessionStreamRegistry, 'hasWatchers' | 'publish'>
  homeDir?: string
  run?: Parameters<typeof runSubagentStatusLine>[0]['run']
  timers?: Timers
  tickMs?: number
  debounceMs?: number
}

/**
 * The subagent rows a plugin's `subagentStatusLine` rewrites for one conversation, as a read model
 * the server keeps: the command runs when the rows' inputs change (`subagent-rows-live.ts`), and
 * a read serves the rows it last drew. `active` says whether any enabled plugin sets one.
 */
export function createSubagentRows(deps: SubagentRowsDeps) {
  async function compute(
    userId: string,
    sessionId: string,
    samples: (taskId: string, tokens: number) => number[],
  ): Promise<SubagentRowsComputed> {
    const session = await deps.requireSession(userId, sessionId)
    const cwd = await deps.resolveSessionWorkingDir(userId, session)
    // The person's own Claude Code settings, a higher layer than any plugin's default.
    const own = settingsCommandLine(
      readSettingsFileLayers({ homeDir: deps.homeDir ?? claudeCodeHome(), cwd }),
      'subagentStatusLine',
    )
    const line = own
      ? { pluginName: '', pluginRoot: '', command: own.command }
      : activeSubagentStatusLine(await deps.buildSessionPluginCatalog(userId, session))
    if (!line) return { view: { active: false, rows: [] }, running: false, ids: [] }
    const runs = await deps.listDelegatedRuns(userId, sessionId)
    const tasks: SubagentTask[] = []
    for (const run of runs.filter((entry) => entry.status !== 'closed').slice(0, MAX_TASKS)) {
      const child = await deps.getSession(userId, run.sessionId)
      if (!child) continue
      const model = run.agentId ? agentRoute(child, run.agentId)?.modelId : undefined
      const tokenCount = run.usage?.tokens ?? 0
      tasks.push({
        id: run.sessionId,
        ...(child.taskName ? { name: child.taskName } : {}),
        type: 'local_agent',
        agentType: agentTypeOf(run.agentId),
        status: taskStatus(run.status),
        description: child.title || run.taskName,
        label: run.progress || child.title || run.taskName,
        startTime: Date.parse(child.createdAt) || 0,
        ...(model ? { model } : {}),
        tokenCount,
        tokenSamples: samples(run.sessionId, tokenCount),
        cwd,
      })
    }
    const rows = await runSubagentStatusLine({
      line,
      tasks,
      sessionId,
      cwd,
      columns: COLUMNS,
      homeDir: deps.homeDir ?? userHome(),
      ...(deps.run ? { run: deps.run } : {}),
    })
    return {
      view: { active: true, rows },
      running: tasks.some((task) => task.status === 'running'),
      // Every row of the subtree, closed ones too: a change to any of them may change the rows.
      ids: runs.map((run) => run.sessionId),
    }
  }

  const live = createSubagentRowsLive({
    compute,
    watched: (userId, ids) => ids.some((id) => deps.streamRegistry.hasWatchers(userId, id)),
    publish: (userId) =>
      deps.streamRegistry.publish(userId, '', {
        type: 'resources.changed',
        resources: ['subagent-rows'],
      }),
    locate: async (userId, id) => {
      const session = await deps.getSession(userId, id)
      return session ? [session.parentSessionId, session.rootSessionId] : []
    },
    ...(deps.timers ? { timers: deps.timers } : {}),
    ...(deps.tickMs !== undefined ? { tickMs: deps.tickMs } : {}),
    ...(deps.debounceMs !== undefined ? { debounceMs: deps.debounceMs } : {}),
  })

  return {
    /** The rows last drawn for `sessionId`, drawn now when no client has asked for them yet. */
    async getSubagentRows(userId: string, sessionId: string): Promise<SubagentRowsView> {
      await deps.requireSession(userId, sessionId)
      return live.read(userId, sessionId)
    },
    /** What moves the rows: the change-feed consumer feeds it (`subagent-rows-changes.ts`). */
    subagentRowsLive: live,
  }
}
