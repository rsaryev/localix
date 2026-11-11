/**
 * Elicitation, ElicitationResult, MessageDisplay and WorktreeCreate on the kit session: the input
 * a hook reads, and its answer as the chat applies it.
 */
import { describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HooksSettings } from '@rsaryev/llx-plugin'
import { tempDirPerTest } from '@localixai/testing'
import type { McpElicitationHookRequest } from '../../../agent-core/tools/hitl/mcp-elicitation'
import { hookTestSession } from '../testing'
import { createKitHooksRuntime } from './runtime'

const dir = tempDirPerTest('kit-display-events-')
const json = (value: unknown) => `echo '${JSON.stringify(value)}'`
const capture = (name: string, then = 'exit 0') => `cat > "${join(dir(), name)}"; ${then}`
const input = (name: string) => JSON.parse(readFileSync(join(dir(), name), 'utf8'))
const groups = (event: string, ...commands: { matcher?: string; command: string }[]) =>
  ({
    [event]: commands.map(({ matcher, command }) => ({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command }],
    })),
  }) as HooksSettings
const runtime = (hooks: HooksSettings) =>
  createKitHooksRuntime(hookTestSession(dir(), dir(), hooks), { cwd: dir() })
const accept = (content: Record<string, unknown>, event = 'Elicitation') =>
  json({ hookSpecificOutput: { hookEventName: event, action: 'accept', content } })

const form: McpElicitationHookRequest = {
  server: 'issue-tracker',
  message: 'Which project?',
  mode: 'form',
  requestedSchema: { type: 'object', properties: { project_key: { type: 'string' } } },
}

describe('Elicitation', () => {
  it('reports the request and answers for the person on its server only', async () => {
    const rt = runtime(
      groups(
        'Elicitation',
        { matcher: 'issue-tracker', command: capture('el.json', accept({ project_key: 'DOCS' })) },
        { matcher: 'other', command: capture('never.json') },
      ),
    )
    expect(await rt.runElicitation(form)).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS' },
    })
    expect(input('el.json')).toMatchObject({
      hook_event_name: 'Elicitation',
      mcp_server_name: 'issue-tracker',
      message: 'Which project?',
      mode: 'form',
      requested_schema: form.requestedSchema,
    })
    expect(() => input('never.json')).toThrow()
  })

  it('URL mode carries the url and the elicitation id', async () => {
    const rt = runtime(groups('Elicitation', { command: capture('url.json') }))
    const request: McpElicitationHookRequest = {
      server: 'auth',
      message: 'Sign in',
      mode: 'url',
      url: 'https://auth.example.com',
      elicitationId: 'e-1',
    }
    expect(await rt.runElicitation(request)).toBeUndefined()
    expect(input('url.json')).toMatchObject({
      mode: 'url',
      url: 'https://auth.example.com',
      elicitation_id: 'e-1',
    })
  })
})

describe('ElicitationResult', () => {
  it("reports the person's answer and may replace it", async () => {
    const rt = runtime(
      groups('ElicitationResult', {
        matcher: 'issue-tracker',
        command: capture('er.json', accept({ project_key: 'DOCS-2' }, 'ElicitationResult')),
      }),
    )
    const answer = { action: 'accept' as const, content: { project_key: 'DOCS' } }
    expect(await rt.runElicitationResult(form, answer)).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS-2' },
    })
    expect(input('er.json')).toMatchObject({
      hook_event_name: 'ElicitationResult',
      mcp_server_name: 'issue-tracker',
      action: 'accept',
      content: { project_key: 'DOCS' },
    })
  })
})

describe('MessageDisplay', () => {
  it('sends the whole settled message once and returns the text to show', async () => {
    const shown = json({
      hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: 'Shown' },
    })
    const rt = runtime(groups('MessageDisplay', { command: capture('md.json', shown) }))
    expect(await rt.runMessageDisplay({ turnId: 't1', messageId: 'm1', text: 'Original' })).toEqual(
      { displayContent: 'Shown' },
    )
    expect(input('md.json')).toMatchObject({
      hook_event_name: 'MessageDisplay',
      turn_id: 't1',
      message_id: 'm1',
      index: 0,
      final: true,
      delta: 'Original',
    })
  })

  it('no displayContent shows the original', async () => {
    const rt = runtime(groups('MessageDisplay', { command: json({ systemMessage: 'ignored' }) }))
    expect(await rt.runMessageDisplay({ turnId: 't', messageId: 'm', text: 'Original' })).toEqual(
      {},
    )
  })
})

describe('WorktreeCreate', () => {
  it('no hook: the chat makes the worktree itself', async () => {
    expect(await runtime({}).runWorktreeCreate('feature')).toBeUndefined()
  })

  it("the folder the hook prints is the worktree's", async () => {
    const tree = join(dir(), 'trees', 'feature')
    mkdirSync(tree, { recursive: true })
    const rt = runtime(groups('WorktreeCreate', { command: `echo "${tree}"` }))
    expect(await rt.runWorktreeCreate('feature')).toMatchObject({ ok: true, path: tree })
  })

  it('a failing hook fails the creation', async () => {
    const rt = runtime(groups('WorktreeCreate', { command: 'echo nope >&2; exit 1' }))
    expect((await rt.runWorktreeCreate('feature'))?.ok).toBe(false)
  })
})
