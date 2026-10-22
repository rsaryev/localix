/**
 * Elicitation, ElicitationResult and MessageDisplay: Claude Code's input fields, matchers and
 * folds, and the hand-off of the elicitation hooks to an MCP tool call.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import type { AgentTool, AgentToolExecutionContext } from '@localixai/agent/agents'

import type {
  McpElicitationHookCarrier,
  McpElicitationHookRequest,
} from '../agent-core/tools/hitl/mcp-elicitation'
import { parseHooksBlock } from './config'
import {
  isCcHookEvent,
  isInertCcHookEvent,
  type CcHookHandler,
  type CcHookRegistry,
} from './contracts'
import { createCcHooksRuntime } from './run'
import { wrapToolsWithCcHooks } from './wrap-tools'

const dir = tempDirPerTest('cc-display-')
const silent = { warn: () => {}, info: () => {} }
const cmd = (command: string): CcHookHandler => ({ source: 'plugin', command, timeoutMs: 5000 })
const capture = (name: string, then = 'exit 0') => cmd(`cat > "${join(dir(), name)}"; ${then}`)
const input = (name: string) => JSON.parse(readFileSync(join(dir(), name), 'utf8'))
const json = (value: unknown) => `echo '${JSON.stringify(value)}'`
const make = (registry: CcHookRegistry) =>
  createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })
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
    const rt = make({
      Elicitation: [
        {
          matcher: 'issue-tracker',
          handlers: [cmd(`cat > "${join(dir(), 'el.json')}"; ${accept({ project_key: 'DOCS' })}`)],
        },
        { matcher: 'other', handlers: [capture('never.json')] },
      ],
    })
    expect(await rt.runElicitation(form)).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS' },
    })
    expect(input('el.json')).toEqual({
      session_id: 's1',
      transcript_path: '',
      cwd: dir(),
      hook_event_name: 'Elicitation',
      mcp_server_name: 'issue-tracker',
      message: 'Which project?',
      mode: 'form',
      requested_schema: form.requestedSchema,
    })
    expect(() => input('never.json')).toThrow()
  })

  it('URL mode carries the url and the elicitation id', async () => {
    const rt = make({ Elicitation: [{ handlers: [capture('url.json')] }] })
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

  it('exit 2 declines and its hookSpecificOutput is ignored', async () => {
    const rt = make({
      Elicitation: [{ handlers: [cmd(`cat >/dev/null; ${accept({ a: 1 })}; exit 2`)] }],
    })
    expect(await rt.runElicitation(form)).toEqual({ action: 'decline' })
  })

  it('a top-level decision:block overrides an action in the same output', async () => {
    const out = { decision: 'block', hookSpecificOutput: { action: 'accept', content: { a: 1 } } }
    const rt = make({ Elicitation: [{ handlers: [cmd(`cat >/dev/null; ${json(out)}`)] }] })
    expect(await rt.runElicitation(form)).toEqual({ action: 'decline' })
  })

  it('a decline from one hook overrides an accept from another', async () => {
    const decline = json({ hookSpecificOutput: { action: 'decline' } })
    const rt = make({
      Elicitation: [
        { handlers: [cmd(`cat >/dev/null; ${accept({ project_key: 'DOCS' })}`)] },
        { handlers: [cmd(`cat >/dev/null; ${decline}`)] },
      ],
    })
    expect(await rt.runElicitation(form)).toEqual({ action: 'decline' })
  })

  it('a hook that fails or prints nothing leaves the request to the person', async () => {
    const rt = make({
      Elicitation: [
        { handlers: [cmd(`cat >/dev/null; ${accept({ a: 1 })}; exit 1`)] },
        { handlers: [cmd('cat >/dev/null')] },
      ],
    })
    expect(await rt.runElicitation(form)).toBeUndefined()
  })
})

describe('ElicitationResult', () => {
  it("reports the person's answer and may replace it", async () => {
    const rt = make({
      ElicitationResult: [
        {
          matcher: 'issue-tracker',
          handlers: [
            cmd(
              `cat > "${join(dir(), 'er.json')}"; ${accept({ project_key: 'DOCS-2' }, 'ElicitationResult')}`,
            ),
          ],
        },
      ],
    })
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
      mode: 'form',
    })
  })

  it('exit 2 blocks the response', async () => {
    const rt = make({ ElicitationResult: [{ handlers: [cmd('cat >/dev/null; exit 2')] }] })
    expect(await rt.runElicitationResult(form, { action: 'accept', content: {} })).toEqual({
      action: 'decline',
    })
  })
})

describe('MessageDisplay', () => {
  it('sends the whole settled message once and returns the text to show', async () => {
    const shown = json({
      hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: 'Shown' },
    })
    const rt = make({
      // No matcher support: a matcher is ignored and the hook still fires.
      MessageDisplay: [
        { matcher: 'nothing', handlers: [cmd(`cat > "${join(dir(), 'md.json')}"; ${shown}`)] },
      ],
    })
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

  it('a failing hook, or no displayContent, shows the original', async () => {
    const rt = make({
      MessageDisplay: [
        {
          handlers: [
            cmd(`cat >/dev/null; ${json({ hookSpecificOutput: { displayContent: 'x' } })}; exit 1`),
          ],
        },
        { handlers: [cmd(`cat >/dev/null; ${json({ systemMessage: 'ignored' })}`)] },
      ],
    })
    expect(await rt.runMessageDisplay({ turnId: 't', messageId: 'm', text: 'Original' })).toEqual(
      {},
    )
  })
})

describe('the display events in a hooks file', () => {
  const parse = (hooks: Record<string, unknown>) =>
    parseHooksBlock({ hooks }, 'plugin', { projectDir: '/p' }, [] as never)

  it('they are dispatched, no longer inert', () => {
    for (const event of ['Elicitation', 'ElicitationResult', 'MessageDisplay']) {
      expect(isCcHookEvent(event)).toBe(true)
      expect(isInertCcHookEvent(event)).toBe(false)
    }
  })

  it('MessageDisplay defaults to Claude Code’s 10 second timeout', () => {
    const registry = parse({ MessageDisplay: [{ hooks: [{ type: 'command', command: 'c' }] }] })
    expect(registry.MessageDisplay?.[0]?.handlers[0]?.timeoutMs).toBe(10_000)
  })
})

describe('an MCP tool call receives the elicitation hooks', () => {
  const seen: Array<(AgentToolExecutionContext & McpElicitationHookCarrier) | undefined> = []
  const tool = {
    name: 'mcp_issue_tracker_pick',
    async execute(_id, _input, _signal, _onUpdate, context) {
      seen.push(context)
      return { content: 'ok' }
    },
  } as AgentTool

  it('only when an Elicitation or ElicitationResult hook is registered', async () => {
    const withHooks = make({
      Elicitation: [{ handlers: [cmd(`cat >/dev/null; ${accept({ project_key: 'DOCS' })}`)] }],
    })
    const [wrapped] = wrapToolsWithCcHooks([tool], withHooks, silent)
    await wrapped!.execute('c1', {}, undefined, undefined, { interactive: true })
    const hooks = seen.pop()?.mcpElicitationHooks
    expect(await hooks?.before(form)).toEqual({
      action: 'accept',
      content: { project_key: 'DOCS' },
    })

    const other = make({ Stop: [{ handlers: [cmd('true')] }] })
    const [plain] = wrapToolsWithCcHooks([tool], other, silent)
    await plain!.execute('c2', {}, undefined, undefined, { interactive: true })
    expect(seen.pop()?.mcpElicitationHooks).toBeUndefined()
  })
})
