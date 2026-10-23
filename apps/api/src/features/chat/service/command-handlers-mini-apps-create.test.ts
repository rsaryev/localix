import { describe, expect, test } from 'bun:test'

import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { handleMiniAppCreateSubcommand } from './command-handlers-mini-apps-create'

const session = {
  id: 'session-1',
  projectId: null,
  agents: [{ id: 'agent-1' }],
} as unknown as SessionRecord

function harness(options: { session?: SessionRecord; busy?: boolean } = {}) {
  const replies: string[] = []
  const macros: { instruction: string; opts: unknown }[] = []
  const ctx = {
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => options.busy ?? false, isRunning: () => options.busy ?? false },
    now: () => '2026-09-22T09:00:00.000Z',
    runMacroCommand: async (
      _u: string,
      _s: string,
      _session: SessionRecord,
      _existing: unknown,
      _prompt: string,
      instruction: string,
      _ts: string,
      opts: unknown,
    ) => {
      macros.push({ instruction, opts })
      return { sessionId: 'session-1', messageId: 'm' } as MessageMutationResponse
    },
  }
  const directReply = async (text: string) => {
    replies.push(text)
    return {} as MessageMutationResponse
  }
  const run = (prompt: string) =>
    handleMiniAppCreateSubcommand(
      ctx as never,
      'u',
      options.session ?? session,
      prompt,
      directReply,
    )
  return { run, replies, macros }
}

describe('/mini-app create', () => {
  test('explains usage without a description', async () => {
    const h = harness()
    await h.run('/mini-app create')
    await h.run('/mini-app create   ')
    expect(h.replies).toHaveLength(2)
    for (const reply of h.replies) expect(reply).toContain('/mini-app create <what it should do>')
    expect(h.macros).toEqual([])
  })

  // The defect the single form replaced: `/mini-app create show GPU temperatures` made a mini app
  // named "show", because a valid first word was taken as the name.
  test('the whole remainder is the description; the agent names the mini app', async () => {
    const h = harness()
    await h.run('/mini-app create show GPU temperatures')
    const instruction = h.macros[0]?.instruction ?? ''
    expect(instruction).toContain('The user wants a new Localix mini app: show GPU temperatures')
    expect(instruction).toContain('Call mini_app_build first')
    expect(instruction).toContain('lower-kebab-case')
    expect(instruction).not.toContain('named show')
    expect(h.macros[0]?.opts).toEqual({
      commandOrigin: { command: '/mini-app create', label: 'Mini app · new' },
      requiredTools: [{ name: 'mini_app_build' }],
    })
  })

  test('a detailed request keeps its lines', async () => {
    const h = harness()
    await h.run('/mini-app create A GPU monitor:\n- temperature\n- fan speed')
    expect(h.macros[0]?.instruction).toContain('A GPU monitor:\n- temperature\n- fan speed')
  })

  // The defect this command used to carry: the agent was handed the Localix source checkout and
  // told to run its scripts. Nothing the agent reads may name a directory of the application.
  test('the agent is never told about a source checkout or a repository script', async () => {
    const h = harness()
    await h.run('/mini-app create Build a GPU monitor')
    expect(h.macros[0]?.instruction).not.toMatch(
      /checkout|scripts\/|bun run|plugin:verify|apps\/ui/iu,
    )
  })

  test('a busy session is refused before the turn starts', async () => {
    const h = harness({ busy: true })
    await expect(h.run('/mini-app create show GPU temperatures')).rejects.toMatchObject({
      code: 'session_busy',
    })
    expect(h.macros).toEqual([])
  })

  test('an agentless session is refused before the turn starts', async () => {
    const h = harness({ session: { ...session, agents: [] } })
    await expect(h.run('/mini-app create show GPU temperatures')).rejects.toMatchObject({
      code: 'session_party_empty',
    })
    expect(h.macros).toEqual([])
  })
})
