import { sql, type Kysely } from 'kysely'

// Every built-in tool had an id of its own (`bash`, `global_search`) beside the name the model
// called it by, and now has one name, Claude Code's spelling (`Bash`, `GlobalSearch`). This is the
// ONE place that knows the old ids: it rewrites every stored row that names a tool by one, in one
// pass, so the code reads the new names only. A rule, a usage count, a recovery row, a stored tool
// call or an activated tool keeps naming the same tool, so what a person switched off does not
// quietly come back on and an old transcript still renders its cards. The table is spelled out
// here and not imported: a migration is final, and must not follow the catalog when it changes.
const RENAMED: Readonly<Record<string, string>> = {
  ask: 'AskUserQuestion',
  context_budget: 'ContextBudget',
  bash: 'Bash',
  read: 'Read',
  search: 'Search',
  write: 'Write',
  edit: 'Edit',
  research: 'Research',
  global_search: 'GlobalSearch',
  tool_output: 'ToolOutput',
  mcp_resources: 'McpResources',
  vault: 'Vault',
  external_agent_sessions: 'ExternalAgentSessions',
  skill: 'Skill',
  jobs: 'Jobs',
  browser: 'Browser',
  store: 'Store',
  workflow: 'Workflow',
  loops: 'Loops',
  mini_app_guide: 'MiniAppGuide',
  skip_answer: 'SkipAnswer',
  configure: 'Configure',
  plan: 'Plan',
  activate_tools: 'ToolSearch',
}

const renamed = (name: string): string => Object.hasOwn(RENAMED, name) ? RENAMED[name]! : name

/** The kinds of stored item that carry a tool's name as `name`. */
const NAMED_ITEMS = new Set(['tool_call', 'command', 'file_change', 'mcp_call'])

/** Rename, in place, every tool name a parsed JSON value holds. Returns whether anything changed. */
function renameIn(node: unknown): boolean {
  if (Array.isArray(node)) return node.map(renameIn).some(Boolean)
  if (node === null || typeof node !== 'object') return false
  const record = node as Record<string, unknown>
  let changed = false
  const set = (key: string) => {
    const value = record[key]
    if (typeof value === 'string' && renamed(value) !== value) {
      record[key] = renamed(value)
      changed = true
    }
  }
  if (typeof record.type === 'string' && NAMED_ITEMS.has(record.type)) set('name')
  set('toolName')
  set('tool_name')
  if (Array.isArray(record.toolNames)) {
    record.toolNames = record.toolNames.map((n) => (typeof n === 'string' ? renamed(n) : n))
    changed = true
  }
  for (const value of Object.values(record)) if (renameIn(value)) changed = true
  return changed
}

/** A fork's stored seed: the tools its parent was shown and the profile the parent ran under. */
function renameForkSeed(seed: Record<string, unknown>): boolean {
  let changed = false
  if (Array.isArray(seed.tools)) {
    for (const tool of seed.tools as Record<string, unknown>[]) {
      if (typeof tool?.name === 'string' && renamed(tool.name) !== tool.name) {
        tool.name = renamed(tool.name)
        delete tool.modelName
        changed = true
      }
    }
  }
  const profile = seed.profile as Record<string, unknown> | undefined
  if (profile && typeof profile === 'object') {
    for (const key of ['toolExposure', 'disabledToolFeatures']) {
      const table = profile[key] as Record<string, unknown> | undefined
      if (!table || typeof table !== 'object') continue
      profile[key] = Object.fromEntries(Object.entries(table).map(([k, v]) => [renamed(k), v]))
      changed = true
    }
    if (Array.isArray(profile.declaredTools)) {
      profile.declaredTools = profile.declaredTools.map((n) =>
        typeof n === 'string' ? renamed(n) : n,
      )
      changed = true
    }
  }
  return changed
}

const BATCH = 500

/** Rewrite one JSON column row by row (by rowid), only the rows that quote an old id. */
async function rewriteJson(
  db: Kysely<unknown>,
  table: string,
  column: string,
  rewrite: (value: Record<string, unknown>) => boolean,
): Promise<void> {
  const old = Object.keys(RENAMED)
  const quoted = old.map((name) => `%"${name}"%`)
  const anyOld = sql.join(
    quoted.map((pattern) => sql`${sql.id(column)} LIKE ${pattern}`),
    sql` OR `,
  )
  let after = 0
  for (;;) {
    const { rows } = await sql<{ k: number; v: string }>`
      SELECT rowid AS k, ${sql.id(column)} AS v FROM ${sql.id(table)}
      WHERE rowid > ${after} AND (${anyOld})
      ORDER BY rowid LIMIT ${BATCH}`.execute(db)
    if (rows.length === 0) return
    for (const row of rows) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row.v)
      } catch {
        continue
      }
      if (parsed === null || typeof parsed !== 'object') continue
      if (rewrite(parsed as Record<string, unknown>)) {
        await sql`UPDATE ${sql.id(table)} SET ${sql.id(column)} = ${JSON.stringify(parsed)}
          WHERE rowid = ${row.k}`.execute(db)
      }
    }
    after = rows[rows.length - 1]!.k
  }
}

async function mergeUsage(db: Kysely<unknown>, before: string, after: string): Promise<void> {
  const stale = await sql<{
    id: string
    user_id: string
    project_id: string
    call_count: number
    error_count: number
    first_seen_at: string
    last_used_at: string | null
  }>`SELECT * FROM tool_usage WHERE tool_name = ${before}`.execute(db)
  for (const row of stale.rows) {
    const kept = await sql<{ id: string }>`SELECT id FROM tool_usage
      WHERE user_id = ${row.user_id} AND project_id = ${row.project_id} AND tool_name = ${after}`.execute(
      db,
    )
    if (kept.rows.length === 0) {
      await sql`UPDATE tool_usage SET tool_name = ${after} WHERE id = ${row.id}`.execute(db)
      continue
    }
    // The new name already has a row: its count takes the old one's, and the old row goes.
    await sql`UPDATE tool_usage SET
        call_count = call_count + ${row.call_count},
        error_count = error_count + ${row.error_count},
        first_seen_at = min(first_seen_at, ${row.first_seen_at}),
        last_used_at = max(coalesce(last_used_at, ''), coalesce(${row.last_used_at}, ''))
      WHERE id = ${kept.rows[0]!.id}`.execute(db)
    await sql`DELETE FROM tool_usage WHERE id = ${row.id}`.execute(db)
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [before, after] of Object.entries(RENAMED)) {
    await sql`UPDATE capability_rule SET action = ${'tool:' + after} WHERE action = ${'tool:' + before}`.execute(
      db,
    )
    await mergeUsage(db, before, after)
    await sql`UPDATE tool_output_artifacts SET tool_name = ${after} WHERE tool_name = ${before}`.execute(
      db,
    )
    await sql`UPDATE tool_output_chunks SET tool_name = ${after} WHERE tool_name = ${before}`.execute(
      db,
    )
  }

  // The deferred tools a session activated sit in its JSON list.
  await rewriteJson(db, 'agent_sessions', 'activated_tools', (list) => {
    const names = list as unknown as string[]
    if (!Array.isArray(names)) return false
    names.forEach((name, i) => {
      if (typeof name === 'string') names[i] = renamed(name)
    })
    return true
  })

  // Stored items and the model-context records that hold tool calls and results.
  await rewriteJson(db, 'agent_messages', 'payload_json', renameIn)
  await rewriteJson(db, 'agent_message_model_context', 'turn_context_json', renameIn)
  await rewriteJson(db, 'agent_message_model_context', 'checkpoint_json', renameIn)
  await rewriteJson(db, 'agent_queue_items', 'payload_json', renameIn)
  await rewriteJson(db, 'participant_lane_snapshots', 'snapshot_json', (value) => {
    const forked = renameForkSeed(value)
    return renameIn(value) || forked
  })
}
