import { describe, expect, test } from 'bun:test'
import { runAgentLoop, type AgentTool as PiAgentTool } from '@earendil-works/pi-agent-core'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
  type AssistantMessage as PiAssistantMessage,
  type Message,
} from '@earendil-works/pi-ai'

import type { PiTurnState } from './event-codec'
import {
  assembleStopConditions,
  composeStopConditions,
  turnBudget,
  type StopCondition,
} from './stop-conditions'

function assistant(content: PiAssistantMessage['content']): PiAssistantMessage {
  return { ...fauxAssistantMessage(''), content }
}

const toolCallMessage = assistant([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }])

describe('composable stop conditions', () => {
  test('no conditions compose to no hook — exactly a run without maxTurns', () => {
    const turn: PiTurnState = { index: 0, terminated: false }
    expect(composeStopConditions(turn, [], () => {})).toBeUndefined()
  })

  test('turnBudget preserves the exact threshold behavior of the old closure', async () => {
    // A natural text-only final answer at the boundary is not a budget stop, but the flag
    // must still be (re)written on every evaluation, as the old closure did.
    const natural: PiTurnState = { index: 1, maxTurns: 1, terminated: false }
    const fired: string[] = []
    const shouldStop = composeStopConditions(natural, [turnBudget], (name) => fired.push(name))!
    expect(await shouldStop({ message: assistant([]) })).toBeUndefined()
    expect(natural.budgetExhausted).toBe(false)
    expect(fired).toEqual([])

    // The same boundary with pending tool results is a budget stop, attributed by name.
    const exhausted: PiTurnState = { index: 1, maxTurns: 1, terminated: false }
    const stop = composeStopConditions(exhausted, [turnBudget], (name) => fired.push(name))!
    expect(await stop({ message: toolCallMessage })).toEqual({ action: 'end' })
    expect(exhausted.budgetExhausted).toBe(true)
    expect(fired).toEqual(['turnBudget'])

    // Below the boundary nothing stops, matching shouldStopForTurnBudget exactly.
    const early: PiTurnState = { index: 0, maxTurns: 2, terminated: false }
    const none = composeStopConditions(early, [turnBudget], (name) => fired.push(name))!
    expect(await none({ message: toolCallMessage })).toBeUndefined()
    expect(fired).toEqual(['turnBudget'])
  })

  test('the first firing condition wins and later ones are not consulted', async () => {
    const turn: PiTurnState = { index: 1, maxTurns: 1, terminated: false }
    let laterEvaluated = false
    const later: StopCondition = {
      name: 'later',
      shouldStop: () => {
        laterEvaluated = true
        return true
      },
    }
    let stoppedBy: string | undefined
    const shouldStop = composeStopConditions(turn, [turnBudget, later], (name) => {
      stoppedBy = name
    })!

    expect(await shouldStop({ message: toolCallMessage })).toEqual({ action: 'end' })
    expect(stoppedBy).toBe('turnBudget')
    expect(laterEvaluated).toBe(false)
  })

  test('error and aborted turns preserve the old hook boundary', async () => {
    const turn: PiTurnState = { index: 0, terminated: false }
    let evaluated = false
    const hook = composeStopConditions(
      turn,
      [
        {
          name: 'must-not-run',
          shouldStop: () => {
            evaluated = true
            return true
          },
        },
      ],
      () => {},
    )!

    expect(await hook({ message: { ...assistant([]), stopReason: 'error' } })).toBeUndefined()
    expect(evaluated).toBe(false)
  })

  test('a custom condition stops the real loop and its name is recorded', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('echo', {}, { id: 'call-1' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('second turn that must never be requested'),
    ])
    const echo: PiAgentTool = {
      name: 'echo',
      label: 'Echo',
      description: 'echoes',
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: undefined }),
    }
    const turn: PiTurnState = { index: 0, terminated: false }
    const afterAnyToolTurn: StopCondition = {
      name: 'after-any-tool-turn',
      shouldStop: ({ message }) => message.content.some((part) => part.type === 'toolCall'),
    }
    let stoppedBy: string | undefined

    await runAgentLoop(
      [],
      // The loop's context is the transcript plus the runtime tool list; the system prompt
      // is a message in it now, and this case needs none.
      { messages: [], tools: [echo] },
      {
        model: faux.getModel(),
        apiKey: 'faux',
        convertToLlm: (messages) => messages as Message[],
        finishTurn: composeStopConditions(turn, [afterAnyToolTurn], (name) => {
          stoppedBy = name
        }),
      },
      async () => {},
      undefined,
      (model, context, options) => faux.provider.streamSimple(model, context, options),
    )

    expect(stoppedBy).toBe('after-any-tool-turn')
    // The condition ended the loop before it could consume the tool results: the
    // scripted second response was never requested.
    expect(faux.getPendingResponseCount()).toBe(1)
  })
})

describe('assembleStopConditions', () => {
  const named = (name: string): StopCondition => ({ name, shouldStop: () => false })

  test('the budget is evaluated before anything that could mask it', () => {
    const list = assembleStopConditions({
      maxTurns: 10,
      adapter: [named('adapter')],
      host: [{ name: 'host', shouldStop: () => false }],
    })
    // Event mapping derives the `max_turns` stop reason from the flag the budget condition
    // writes, so a condition that stopped the run first would report the wrong reason.
    expect(list.map((condition) => condition.name)).toEqual(['turnBudget', 'adapter', 'host'])
  })

  test('no turn cap means no budget condition', () => {
    expect(assembleStopConditions({ adapter: [named('only')] }).map((c) => c.name)).toEqual([
      'only',
    ])
  })

  test('nothing supplied composes to nothing, which installs no hook', () => {
    const list = assembleStopConditions({})
    expect(list).toEqual([])
    // The documented byte-identity guarantee: an empty list leaves pi's loop as if the hook
    // had never been passed.
    expect(composeStopConditions({ index: 0, terminated: false }, list, () => {})).toBeUndefined()
  })

  test('a host condition answers from its own state, not from the turn ledger', async () => {
    let enough = false
    const list = assembleStopConditions({
      host: [{ name: 'seenEnough', shouldStop: () => enough }],
    })
    const turn: PiTurnState = { index: 0, terminated: false }
    let stoppedBy: string | undefined
    const hook = composeStopConditions(turn, list, (name) => {
      stoppedBy = name
    })!
    const message = { role: 'assistant', content: [] } as never

    expect(await hook({ message })).toBeUndefined()
    enough = true
    expect(await hook({ message })).toEqual({ action: 'end' })
    expect(stoppedBy).toBe('seenEnough')
  })
})
