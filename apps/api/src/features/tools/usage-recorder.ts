/**
 * Process-wide tool-usage recorder, the same singleton-sink shape the skills curator uses
 * (`features/skills-curator/usage-recorder.ts`) and for the same reason: the two call sites live
 * deep inside the run loop (`run/event-handlers-tools.ts`, `run/stages/tools.ts`), which is
 * constructed without DB access. Threading a repository down to them would widen
 * `TurnEventContext` for telemetry, which is the tail wagging the dog.
 *
 * Recording is best-effort by design and must never fail, block or slow a tool call. A write that
 * can propagate is a write that can take the run down with it — the exact failure the runtime
 * journal was removed over. When no sink is registered (tests, ad-hoc tool use) every entry point
 * is a no-op.
 *
 * Counters are persisted per call rather than accumulated in memory, and that is not incidental.
 * `context-mode/src/session/analytics.ts:84` describes replacing "the broken in-memory
 * `tool_call_counter`" that "reset to 0 every time the MCP server PID changed (which is what made
 * hours-of-work conversations show '1 call · 5 KB')".
 *
 * The specific failure matters more than the general one: a RAM counter does not merely lose
 * history on a crash, it silently resets on process churn nobody thinks of as an event — and a
 * counter that reads zero looks exactly like a tool nobody uses, which is the one conclusion this
 * table exists to support.
 */

export type ToolUsageSink = (
  toolName: string,
  scope: { userId: string; projectId: string; isError: boolean },
) => void | Promise<void>

export type ToolRosterSink = (
  toolNames: readonly string[],
  scope: { userId: string; projectId: string },
) => void | Promise<void>

let usageSink: ToolUsageSink | null = null
let rosterSink: ToolRosterSink | null = null

export function setToolUsageRecorder(next: ToolUsageSink | null): void {
  usageSink = next
}

export function setToolRosterRecorder(next: ToolRosterSink | null): void {
  rosterSink = next
}

/** Fire-and-forget call tick. Swallows every error — telemetry must not break a tool. */
export function recordToolUse(
  toolName: string,
  scope: { userId: string; projectId?: string | null; isError?: boolean },
): void {
  if (!usageSink || !toolName) return
  try {
    void Promise.resolve(
      usageSink(toolName, {
        userId: scope.userId,
        projectId: scope.projectId ?? '',
        isError: scope.isError === true,
      }),
    ).catch(() => {})
  } catch {
    // best-effort only
  }
}

/**
 * Fire-and-forget availability tick for the tools a run actually surfaced.
 *
 * This is what keeps the GC honest about new capabilities: without it a plugin enabled five
 * minutes ago has no row, no `first_seen_at`, zero calls — indistinguishable from a tool the user
 * has ignored for a month, and the first thing the GC would offer to disable.
 */
export function recordToolRoster(
  toolNames: readonly string[],
  scope: { userId: string; projectId?: string | null },
): void {
  if (!rosterSink || toolNames.length === 0) return
  try {
    void Promise.resolve(
      rosterSink(toolNames, { userId: scope.userId, projectId: scope.projectId ?? '' }),
    ).catch(() => {})
  } catch {
    // best-effort only
  }
}
