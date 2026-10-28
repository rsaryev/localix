/**
 * CC-hooks parity coverage (gap-analysis P1-hooks 1/2/4/5): new events
 * (SessionEnd / SubagentStart / SubagentStop / PreCompact), the `if` guard,
 * `async` / `asyncRewake`, `once`, the hyphen matcher, and parsing the real
 * security-guidance plugin hooks.json as an acceptance fixture.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { matchesField, matchesToolName, toolNameCandidates } from './matcher'
import { evaluateIfGuard } from './if-guard'
import { parseHooksBlock } from './config'
import { createCcHooksRuntime } from './run'
import type { CcHookHandler, CcHookRegistry } from './contracts'

const silentLogger = { warn: () => {}, info: () => {} }

// Wait for microtask/async work spawned by a fire-and-forget hook to settle.
/**
 * Until an async hook's process has reported (it outlives the call that started it), checked on
 * each tick and bounded by a deadline, never a guessed sleep that a loaded machine overruns.
 */
async function settled(done: () => boolean, deadlineMs = 10_000) {
  const until = Date.now() + deadlineMs
  while (!done() && Date.now() < until) await new Promise((r) => setTimeout(r, 10))
}

function reg(handlers: Partial<Record<keyof CcHookRegistry, CcHookHandler[]>>): CcHookRegistry {
  const out: CcHookRegistry = {}
  for (const [event, hs] of Object.entries(handlers))
    out[event as keyof CcHookRegistry] = [{ handlers: hs as CcHookHandler[] }]
  return out
}
const cmd = (command: string, extra?: Partial<CcHookHandler>): CcHookHandler => ({
  source: 'user',
  command,
  timeoutMs: 5000,
  ...extra,
})
const make = (
  registry: CcHookRegistry,
  extra?: Partial<Parameters<typeof createCcHooksRuntime>[0]>,
) =>
  createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger: silentLogger,
    ...extra,
  })

// ---------------------------------------------------------------------------
// Matcher — hyphenated names exact-match (v2.1.195), not regex-contain
// ---------------------------------------------------------------------------
describe('matcher: hyphenated exact-match', () => {
  it('a hyphenated matcher is an exact string, not a regex-contain', () => {
    expect(matchesToolName('my-tool', 'my-tool')).toBe(true)
    // exact — must NOT match a longer name that merely contains it.
    expect(matchesToolName('my-tool', 'my-tool-extra')).toBe(false)
    expect(matchesToolName('my', 'my-tool')).toBe(false)
  })
  it('hyphenated agent-type matcher (SubagentStart/Stop) exact-matches', () => {
    expect(matchesField('code-reviewer', 'code-reviewer')).toBe(true)
    expect(matchesField('code-reviewer', 'code-reviewer-2')).toBe(false)
    expect(matchesField('code-reviewer|planner', 'planner')).toBe(true)
  })
  it('a hyphenated candidate stays a single candidate (no alias)', () => {
    expect(toolNameCandidates('my-mcp-tool')).toEqual(['my-mcp-tool'])
  })
})

// ---------------------------------------------------------------------------
// `if` guard
// ---------------------------------------------------------------------------
describe('if guard', () => {
  it('Bash(git commit:*) matches a git-commit command, not others', () => {
    expect(evaluateIfGuard('Bash(git commit:*)', 'Bash', { command: 'git commit -m "x"' })).toBe(
      true,
    )
    expect(evaluateIfGuard('Bash(git commit:*)', 'Bash', { command: 'git status' })).toBe(false)
    expect(evaluateIfGuard('Bash(git push:*)', 'Bash', { command: 'git push origin main' })).toBe(
      true,
    )
    expect(evaluateIfGuard('Bash(git:*)', 'Bash', { command: 'github-cli status' })).toBe(false)
  })
  it('strips leading VAR=value assignments and checks &&-subcommands', () => {
    expect(
      evaluateIfGuard('Bash(git commit:*)', 'Bash', { command: 'FOO=1 git commit -m x' }),
    ).toBe(true)
    expect(evaluateIfGuard('Bash(git push:*)', 'Bash', { command: 'npm test && git push' })).toBe(
      true,
    )
  })
  it('fails OPEN on command substitution (best-effort)', () => {
    expect(evaluateIfGuard('Bash(git commit:*)', 'Bash', { command: 'echo $(git commit)' })).toBe(
      true,
    )
  })
  it('the tool part must match (CC↔engine name aware)', () => {
    expect(evaluateIfGuard('Bash(git commit:*)', 'Search', { command: 'git commit' })).toBe(false)
    // Bare tool rule = tool-only match.
    expect(evaluateIfGuard('Bash', 'Bash', { command: 'anything' })).toBe(true)
  })
  it('file-tool glob matches file_path', () => {
    expect(evaluateIfGuard('Edit(*.ts)', 'Edit', { file_path: '/a/b.ts' })).toBe(true)
    expect(evaluateIfGuard('Edit(*.ts)', 'Write', { file_path: '/a/b.md' })).toBe(false)
    // A batch matches when ANY of its files does — the hook must see a .ts among .md files.
    const batch = { files: [{ path: '/a/b.md' }, { path: '/a/c.ts' }] }
    expect(evaluateIfGuard('Write(*.ts)', 'Write', batch)).toBe(true)
    const edits = { edits: [{ path: '/a/b.md' }, { path: '/a/c.ts' }] }
    expect(evaluateIfGuard('Edit(*.ts)', 'Edit', edits)).toBe(true)
    expect(evaluateIfGuard('Edit(*.ts)', 'Edit', { edits: [{ path: '/a/b.md' }] })).toBe(false)
  })
  it('a batched read runs the hook when ANY of its files matches', () => {
    const input = { path: 'README.md', reads: [{ path: 'src/a.ts' }, { path: 'config/.env' }] }
    expect(evaluateIfGuard('Read(*.env)', 'Read', input)).toBe(true)
    expect(evaluateIfGuard('Read(*.py)', 'Read', input)).toBe(false)
  })
  it('runtime: an if-guarded PostToolUse hook only fires when the guard passes', async () => {
    const rt = make({
      PostToolUse: [
        {
          matcher: 'Bash',
          handlers: [
            cmd(
              `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"committed"}}'`,
              { if: 'Bash(git commit:*)' },
            ),
          ],
        },
      ],
    })
    const hit = await rt.runPostToolUse('Bash', { command: 'git commit -m x' }, { content: 'ok' })
    expect(hit.additionalContext).toBe('committed')
    const miss = await rt.runPostToolUse('Bash', { command: 'ls' }, { content: 'ok' })
    expect(miss.additionalContext).toBeUndefined()
  })
  it('runtime: an if-guarded handler never runs on a NON-tool event', async () => {
    const rt = make(
      reg({
        Stop: [
          cmd(`cat >/dev/null; echo '{"decision":"block","reason":"x"}'`, {
            if: 'Bash(git commit:*)',
          }),
        ],
      }),
    )
    expect(await rt.runStop()).toEqual({ blocked: false })
  })
})

// ---------------------------------------------------------------------------
// async / asyncRewake
// ---------------------------------------------------------------------------
/** An armed rewake that records how it ended: fired with a message, or dismissed. */
const rewakeInto =
  (woke: string[], dismissed: string[] = []) =>
  async () => ({
    fire: (message: string) => void woke.push(message),
    dismiss: (reason: string) => void dismissed.push(reason),
  })

describe('async + asyncRewake', () => {
  it('an async hook never blocks the turn (decision ignored)', async () => {
    const rt = make(
      reg({ UserPromptSubmit: [cmd('cat >/dev/null; echo "no" >&2; exit 2', { async: true })] }),
    )
    const r = await rt.runUserPromptSubmit('hi')
    expect(r.blocked).toBe(false) // async can't block
  })
  it('asyncRewake exit-2 wakes the session with rewakeMessage + stderr', async () => {
    const woke: string[] = []
    const dismissed: string[] = []
    const rt = make(
      reg({
        Stop: [
          cmd('cat >/dev/null; echo "found XSS" >&2; exit 2', {
            async: true,
            asyncRewake: true,
            rewakeMessage: 'Review:',
          }),
        ],
      }),
      { rewake: rewakeInto(woke, dismissed) },
    )
    const r = await rt.runStop()
    expect(r.blocked).toBe(false) // async hook doesn't block Stop
    await settled(() => woke.length + dismissed.length > 0)
    expect(dismissed).toEqual([])
    expect(woke).toHaveLength(1)
    expect(woke[0]).toContain('Review:')
    expect(woke[0]).toContain('found XSS')
  })
  it('asyncRewake that exits 0 does NOT wake — its armed notice is dismissed', async () => {
    const woke: string[] = []
    const dismissed: string[] = []
    const rt = make(
      reg({
        Stop: [
          cmd('cat >/dev/null; echo ok', {
            async: true,
            asyncRewake: true,
            rewakeMessage: 'Review:',
          }),
        ],
      }),
      { rewake: rewakeInto(woke, dismissed) },
    )
    await rt.runStop()
    await settled(() => woke.length + dismissed.length > 0)
    expect(woke).toHaveLength(0)
    expect(dismissed).toEqual(['passed'])
  })
})

// ---------------------------------------------------------------------------
// once
// ---------------------------------------------------------------------------
describe('once', () => {
  it('a once handler runs at most once per session (shared onceKeys)', async () => {
    const onceKeys = new Set<string>()
    const r = reg({
      SessionStart: [cmd('cat >/dev/null; echo "hi"', { once: true, source: 'skill' })],
    })
    const first = make(r, { onceKeys })
    expect((await first.runSessionStart()).additionalContext).toBe('hi')
    // A NEW per-run runtime sharing the same onceKeys must NOT re-fire it.
    const second = make(r, { onceKeys })
    expect((await second.runSessionStart()).additionalContext).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// New events — stdin shape + firing
// ---------------------------------------------------------------------------
describe('new events', () => {
  it('SessionEnd: side-effect hooks fire with the reason on stdin', async () => {
    const woke: string[] = []
    // SessionEnd has no decision control; assert stdin plumbing via asyncRewake wake.
    const rt = make(
      reg({
        SessionEnd: [
          cmd('R=$(cat | sed -n \'s/.*"reason":"\\([^"]*\\)".*/\\1/p\'); echo "$R" >&2; exit 2', {
            async: true,
            asyncRewake: true,
            rewakeMessage: 'ended:',
          }),
        ],
      }),
      { rewake: rewakeInto(woke) },
    )
    await rt.runSessionEnd('logout')
    await settled(() => woke.length > 0)
    expect(woke[0]).toContain('logout')
  })
  it('SubagentStop: matches the agent type + surfaces last_assistant_message', async () => {
    const rt = make({
      SubagentStop: [
        {
          matcher: 'code-reviewer',
          handlers: [cmd(`cat >/dev/null; echo '{"decision":"block","reason":"redo"}'`)],
        },
      ],
    })
    const hit = await rt.runSubagentStop('code-reviewer', 'child-1', 'done')
    expect(hit).toEqual({ blocked: true, reason: 'redo' })
    // A different agent type doesn't match.
    const miss = await rt.runSubagentStop('planner', 'child-2', null)
    expect(miss).toEqual({ blocked: false })
  })
  it('SubagentStart: injects additionalContext for the child', async () => {
    const rt = make(
      reg({
        SubagentStart: [
          cmd(
            `cat >/dev/null; echo '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"be careful"}}'`,
          ),
        ],
      }),
    )
    expect((await rt.runSubagentStart('general-purpose', 'c1')).additionalContext).toBe(
      'be careful',
    )
  })
  it('PreCompact: exit 2 blocks compaction; trigger reaches the hook', async () => {
    const rt = make({
      PreCompact: [
        {
          matcher: 'auto',
          handlers: [
            cmd(`T=$(cat | sed -n 's/.*"trigger":"\\([^"]*\\)".*/\\1/p'); echo "$T" >&2; exit 2`),
          ],
        },
      ],
    })
    const blocked = await rt.runPreCompact('auto')
    expect(blocked.blocked).toBe(true)
    expect(blocked.reason).toBe('auto')
    // A manual trigger doesn't match the `auto` matcher.
    expect(await rt.runPreCompact('manual')).toEqual({ blocked: false })
  })
})

// ---------------------------------------------------------------------------
// Acceptance fixture — a REPRESENTATIVE Claude-Code hooks.json, checked in HERE.
//
// It is NOT a live copy of any shipped plugin. It was modelled on the
// security-guidance plugin back when that plugin carried hooks; that plugin is now
// skills-only (no hooks/ dir, no `hooks` manifest field), and no plugin in the repo
// ships a hooks.json today. The header used to call this "the real security-guidance
// plugin hooks.json", which was a guard that could not fail: it only ever read its own
// private copy, so nothing that happened to any plugin could turn it red.
//
// What it legitimately pins is the PARSER — that parseHooksBlock handles a rich, real-
// world CC hooks.json (matchers, `if` guards, async/asyncRewake, rewake messages). Keep
// it as a parser fixture; do not read it as coverage of a shipped plugin.
// ---------------------------------------------------------------------------
describe('acceptance: parseHooksBlock on a representative CC hooks.json', () => {
  it('parses into a valid registry with if / asyncRewake recognized', () => {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dir, '__fixtures__', 'security-guidance-hooks.json'), 'utf8'),
    )
    const registry = parseHooksBlock(raw, 'plugin', {
      projectDir: '/proj',
      pluginName: 'security-guidance',
      pluginRoot: '/plug',
    })
    // Events present in the fixture all survive parsing.
    expect(registry.SessionStart).toBeDefined()
    expect(registry.UserPromptSubmit).toBeDefined()
    expect(registry.PostToolUse).toBeDefined()
    expect(registry.Stop).toBeDefined()

    // The Bash PostToolUse group carries the `if` + asyncRewake handlers.
    const bashGroup = registry.PostToolUse?.find((g) => g.matcher === 'Bash')
    expect(bashGroup).toBeDefined()
    const gitCommit = bashGroup!.handlers.find((h) => h.if === 'Bash(git commit:*)')
    expect(gitCommit).toBeDefined()
    expect(gitCommit!.asyncRewake).toBe(true)
    expect(gitCommit!.async).toBe(true) // asyncRewake implies async
    expect(gitCommit!.rewakeSummary).toBe('Commit security review found issues')

    // The Stop hook is an asyncRewake background review.
    const stop = registry.Stop?.[0]?.handlers[0]
    expect(stop?.asyncRewake).toBe(true)
    // ${CLAUDE_PLUGIN_ROOT} is expanded by the shell from the env, never pasted into the text.
    expect(stop?.command).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/sg-python.sh')
    expect(stop?.pluginRoot).toBe('/plug')

    // The SessionStart bootstrap keeps its explicit 180s timeout.
    expect(registry.SessionStart?.[0]?.handlers[0]?.timeoutMs).toBe(180_000)
  })
})
