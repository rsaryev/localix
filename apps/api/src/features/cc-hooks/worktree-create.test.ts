/**
 * WorktreeCreate, as Claude Code runs it: the hook makes the worktree and returns its path — a
 * command's last non-empty stdout line (ANSI stripped), an MCP tool's text read the same way, an
 * http body's `hookSpecificOutput.worktreePath`. Failure or no path fails the creation; there is
 * no allow/block model, and no handler at all leaves the worktree to git.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { parseHooksBlock } from './config'
import { CC_INERT_HOOK_EVENTS, isCcHookEvent, type CcHookHandler } from './contracts'
import type { CcMcpToolCaller } from './mcp-tool-hook'
import { worktreePathFromText } from './output-parse'
import { createCcHooksRuntime } from './run'

const dir = tempDirPerTest('cc-worktree-')
const notices: string[] = []
const cmd = (command: string, extra: Partial<CcHookHandler> = {}): CcHookHandler => ({
  source: 'plugin',
  command,
  timeoutMs: 5000,
  ...extra,
})
const make = (handlers: CcHookHandler[], callMcpTool?: CcMcpToolCaller) =>
  createCcHooksRuntime({
    registry: { WorktreeCreate: [{ handlers }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: { warn: () => {}, info: () => {} },
    emitNotice: (message) => notices.push(message),
    ...(callMcpTool ? { callMcpTool } : {}),
  })

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  notices.length = 0
})
const respond = (status: number, body: string) => {
  globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch
}
const http = cmd('', { kind: 'http', httpUrl: 'https://hooks.example/worktree' })

describe('WorktreeCreate: a command hook', () => {
  it('receives the name and returns the last non-empty stdout line, ANSI stripped', async () => {
    const capture = `cat > "${join(dir(), 'in.json')}"`
    const rt = make([
      cmd(`${capture}; printf 'banner\\n\\033[32m../wt/a\\033[0m\\n\\n'; echo noise >&2`),
    ])
    expect(await rt.runWorktreeCreate('wf-1-2')).toEqual({ ok: true, path: '../wt/a', cwd: dir() })
    expect(JSON.parse(readFileSync(join(dir(), 'in.json'), 'utf8'))).toMatchObject({
      hook_event_name: 'WorktreeCreate',
      session_id: 's1',
      cwd: dir(),
      name: 'wf-1-2',
    })
  })

  it('fails the creation on any non-zero exit, exit 2 included, naming stderr', async () => {
    for (const code of [1, 2]) {
      const rt = make([cmd(`echo /tmp/x; echo "svn: no access" >&2; exit ${code}`)])
      expect(await rt.runWorktreeCreate('n')).toEqual({
        ok: false,
        error: 'a WorktreeCreate hook failed: svn: no access',
      })
    }
  })

  it('fails the creation when it prints no path, and stdout JSON is not read as a decision', async () => {
    expect(await make([cmd('true')]).runWorktreeCreate('n')).toEqual({
      ok: false,
      error: 'the WorktreeCreate hook returned no worktree path',
    })
    const json = `echo '{"systemMessage":"hi","continue":false}'`
    expect(await make([cmd(json)]).runWorktreeCreate('n')).toMatchObject({ ok: true })
    expect(notices).toEqual([])
  })

  it('a failing handler fails the creation even after another returned a path', async () => {
    const rt = make([cmd('echo /tmp/a'), cmd('exit 3')])
    expect(await rt.runWorktreeCreate('n')).toMatchObject({ ok: false })
  })

  it('no handler that runs leaves the worktree to git', async () => {
    const none = createCcHooksRuntime({
      registry: { Stop: [{ handlers: [cmd('true')] }] },
      sessionId: 's1',
      projectDir: dir(),
      enabled: true,
      logger: { warn: () => {} },
    })
    expect(await none.runWorktreeCreate('n')).toBeUndefined()
    // An `if` guard never runs off the tool events (CC §3).
    expect(await make([cmd('echo /tmp/a', { if: 'Bash(*)' })]).runWorktreeCreate('n')).toBe(
      undefined,
    )
  })
})

describe('WorktreeCreate: http and mcp_tool hooks', () => {
  it('http reads hookSpecificOutput.worktreePath and discards systemMessage', async () => {
    respond(
      200,
      JSON.stringify({
        systemMessage: 'made it',
        hookSpecificOutput: { hookEventName: 'WorktreeCreate', worktreePath: '/srv/wt/a' },
      }),
    )
    expect(await make([http]).runWorktreeCreate('n')).toEqual({
      ok: true,
      path: '/srv/wt/a',
      cwd: dir(),
    })
    expect(notices).toEqual([])
  })

  it('http with a plain-text body or a non-2xx status fails the creation', async () => {
    respond(200, '/srv/wt/a')
    expect(await make([http]).runWorktreeCreate('n')).toMatchObject({ ok: false })
    respond(500, '{}')
    expect(await make([http]).runWorktreeCreate('n')).toMatchObject({ ok: false })
  })

  it("mcp_tool's text is read like a command's stdout; an error result fails", async () => {
    const tool = cmd('', { kind: 'mcp_tool', mcpTool: 'mcp__vcs__checkout' })
    const text: CcMcpToolCaller = async () => ({ text: 'checking out\n/srv/wt/b\n' })
    expect(await make([tool], text).runWorktreeCreate('n')).toMatchObject({ path: '/srv/wt/b' })
    const failing: CcMcpToolCaller = async () => ({ text: '/srv/wt/b', isError: true })
    expect(await make([tool], failing).runWorktreeCreate('n')).toMatchObject({ ok: false })
  })

  it('the path is the last non-empty line, CSI and OSC escapes stripped', () => {
    expect(worktreePathFromText('a\n\u001b]0;title\u0007/x/y\r\n  \n')).toEqual({
      worktreePath: '/x/y',
    })
    expect(worktreePathFromText('\n \n')).toEqual({})
  })
})

describe('WorktreeCreate in a hooks file', () => {
  it('is dispatched with command, http and mcp_tool handlers; prompt and agent are dropped', () => {
    const skipped: { event: string; type: string }[] = []
    const registry = parseHooksBlock(
      {
        hooks: {
          WorktreeCreate: [
            {
              hooks: [
                { type: 'command', command: 'c' },
                { type: 'http', url: 'http://h' },
                { type: 'mcp_tool', server: 'vcs', tool: 'checkout' },
                { type: 'prompt', prompt: 'p' },
                { type: 'agent', prompt: 'p' },
              ],
            },
          ],
        },
      },
      'plugin',
      { projectDir: '/p' },
      skipped as never,
    )
    expect(isCcHookEvent('WorktreeCreate')).toBe(true)
    expect(registry.WorktreeCreate?.[0]?.handlers.map((h) => h.kind ?? 'command')).toEqual([
      'command',
      'http',
      'mcp_tool',
    ])
    expect(registry.WorktreeCreate?.[0]?.handlers[0]?.timeoutMs).toBe(600_000)
    expect(skipped.map((s) => `${s.event}:${s.type}`)).toEqual([
      'WorktreeCreate:prompt',
      'WorktreeCreate:agent',
    ])
    expect(Object.keys(CC_INERT_HOOK_EVENTS)).toContain('WorktreeRemove')
    expect(Object.keys(CC_INERT_HOOK_EVENTS)).not.toContain('WorktreeCreate')
  })
})
