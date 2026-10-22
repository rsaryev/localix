import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * RESUME, as Claude Code does it: every run journals each `agent()` call's result, and a run
 * relaunched with `resumeFromRunId` replays the earlier run's journal in the order agents start.
 *
 * Each call is keyed by a hash chained over every call before it, in spawn order, so a key names
 * the call AND everything the script asked before it. On replay a call whose key matches a
 * completed entry returns its saved result without running; the first call whose key differs
 * (an edited script, or an earlier result that came out differently) runs live, and so does
 * every call after it. An entry that FAILED runs again and makes every later call run again too.
 * A call that was still running when the run stopped has no entry: it starts over, and the calls
 * after it still replay. Same script and same args: every completed agent is a cache hit.
 *
 * The journal is a file per run under the conversation's folder in `~/.localix/workflow-runs`,
 * beside the script it ran, so a run interrupted by a stop or a restart can be resumed later in
 * the same conversation.
 */

export interface JournalEntry {
  /** 0-based, in the order the run started its `agent()` calls. */
  index: number
  key: string
  status: 'completed' | 'failed'
  value?: unknown
  /** Output tokens and cost the agent spent, when known. */
  tokens?: number
  costUsd?: number
}

/** What a call is keyed by: what it asks, not how it is shown. */
export interface JournalCall {
  prompt: string
  options: Record<string, unknown>
}

const KEYED_OPTIONS = ['schema', 'model', 'effort', 'isolation', 'agentType'] as const

export function chainKey(previous: string, call: JournalCall): string {
  const options = Object.fromEntries(
    KEYED_OPTIONS.filter((name) => call.options[name] !== undefined).map((name) => [
      name,
      call.options[name],
    ]),
  )
  return createHash('sha256')
    .update(previous)
    .update('\0')
    .update(JSON.stringify({ prompt: call.prompt, options }))
    .digest('hex')
    .slice(0, 32)
}

/**
 * The replay of one earlier run. `claim` is called synchronously as each call arrives, so the
 * spawn order is the order the script made its calls.
 */
export function createReplay(previous: readonly JournalEntry[] = []) {
  const byIndex = new Map(previous.map((entry) => [entry.index, entry]))
  let last = ''
  let next = 0
  let diverged = false
  return {
    claim(call: JournalCall): { index: number; key: string; cached?: JournalEntry } {
      const index = next++
      const key = chainKey(last, call)
      last = key
      const prior = byIndex.get(index)
      if (diverged || !prior) return { index, key }
      if (prior.key !== key || prior.status === 'failed') {
        diverged = true
        return { index, key }
      }
      return { index, key, cached: prior }
    },
  }
}

export type WorkflowReplay = ReturnType<typeof createReplay>

const RUN_ID = /^wf-[0-9a-f]{12}$/

export const newRunId = (): string => `wf-${randomBytes(6).toString('hex')}`
export const isRunId = (value: unknown): value is string =>
  typeof value === 'string' && RUN_ID.test(value)

export interface WorkflowRunMeta {
  runId: string
  workflow: string
  args?: unknown
  resumedFrom?: string
}

export interface WorkflowRunStore {
  /** Where a run's files live; the result names it so a person can read the journal. */
  dirOf(runId: string): string
  begin(meta: WorkflowRunMeta, body: string): Promise<void>
  /** Append one entry; appends of one run are written in order. */
  record(runId: string, entry: JournalEntry): void
  /** Every append so far has landed. */
  flush(runId: string): Promise<void>
  /** An earlier run of this conversation, or null when it has none by that id. */
  load(runId: string): Promise<{ meta: WorkflowRunMeta; entries: JournalEntry[] } | null>
}

/** The runs of one conversation, in `dir` (`~/.localix/workflow-runs/<root session>`). */
export function createWorkflowRunStore(dir: string): WorkflowRunStore {
  const pending = new Map<string, Promise<void>>()
  const dirOf = (runId: string) => {
    if (!isRunId(runId)) throw new Error(`Not a workflow run id: ${JSON.stringify(runId)}`)
    return path.join(dir, runId)
  }
  return {
    dirOf,
    async begin(meta, body) {
      const runDir = dirOf(meta.runId)
      await mkdir(runDir, { recursive: true })
      await writeFile(path.join(runDir, 'run.json'), JSON.stringify(meta, null, 2))
      await writeFile(path.join(runDir, 'script.js'), body)
      await writeFile(path.join(runDir, 'journal.jsonl'), '')
    },
    record(runId, entry) {
      const file = path.join(dirOf(runId), 'journal.jsonl')
      const line = `${JSON.stringify(entry)}\n`
      const chained = (pending.get(runId) ?? Promise.resolve())
        .then(() => appendFile(file, line))
        .catch((error: unknown) =>
          console.warn(`[workflow] journal write failed for ${runId}:`, error),
        )
      pending.set(runId, chained)
    },
    async flush(runId) {
      await pending.get(runId)
    },
    async load(runId) {
      if (!isRunId(runId)) return null
      const runDir = dirOf(runId)
      const meta = await readFile(path.join(runDir, 'run.json'), 'utf8').catch(() => null)
      if (meta === null) return null
      const lines = await readFile(path.join(runDir, 'journal.jsonl'), 'utf8').catch(() => '')
      const entries: JournalEntry[] = []
      for (const line of lines.split('\n')) {
        if (!line.trim()) continue
        try {
          entries.push(JSON.parse(line) as JournalEntry)
        } catch {
          // A line cut by a crash mid-write: the calls from it on run again.
          break
        }
      }
      return { meta: JSON.parse(meta) as WorkflowRunMeta, entries }
    },
  }
}
