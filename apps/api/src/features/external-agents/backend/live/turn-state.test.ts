/**
 * A positive `working` signal for the agents whose screens cannot give one.
 *
 * When no manifest rule matches, the evaluator degrades to `idle` — and `idle` settles a `wait`
 * instantly, so a busy delegation reports as finished. For Claude Code that is every non-blocked
 * screen: its working state is read from the terminal's OSC title and the host's snapshot has
 * no title. The agent's own append-only log does have the answer, in the shape of its last record.
 *
 * Measured against 87 real Claude Code transcripts while writing it: the one being
 * written to (0.2 minutes old) read `working`; two finished 2 minutes earlier read `idle`; every
 * older one read `idle`. That is the discrimination the screen could not make.
 */

import { describe, expect, test } from 'bun:test'

import { turnStateOf, turnStateAt, TURN_EVIDENCE_MS } from './turn-state'

/** claude-code shapes, copied from a real `~/.claude/projects/**.jsonl`. */
const cc = {
  toolUse: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use' }] } },
  toolResult: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } },
  answer: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text' }] } },
  thinking: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking' }] } },
  prompt: { type: 'user', message: { role: 'user', content: [{ type: 'text' }] } },
  summary: { type: 'summary', summary: 'a compacted older turn' },
  snapshot: { type: 'file-history-snapshot', messageId: 'm1' },
}

/** Codex shapes, copied from real rollout JSONL: every conversational item is enveloped. */
const responseItem = (payload: Record<string, unknown>) => ({ type: 'response_item', payload })
const codex = {
  call: responseItem({ type: 'function_call', name: 'shell', call_id: 'c1' }),
  output: responseItem({ type: 'function_call_output', call_id: 'c1', output: 'ok' }),
  customCall: responseItem({ type: 'custom_tool_call', name: 'exec', call_id: 'c2' }),
  customOutput: responseItem({ type: 'custom_tool_call_output', call_id: 'c2', output: 'ok' }),
  answer: responseItem({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text' }],
  }),
  prompt: responseItem({ type: 'message', role: 'user', content: [{ type: 'input_text' }] }),
}
/** The other envelope: lifecycle events, which carry the only explicit end-of-turn either format has. */
const eventMsg = (payload: Record<string, unknown>) => ({ type: 'event_msg', payload })
const codexEvent = {
  complete: eventMsg({ type: 'task_complete', last_agent_message: 'Done.' }),
  aborted: eventMsg({ type: 'turn_aborted', reason: 'interrupted' }),
  tokens: eventMsg({ type: 'token_count', info: {}, rate_limits: {} }),
  activity: eventMsg({ type: 'sub_agent_activity', agent_thread_id: 'a1' }),
}

describe('the last record says whether the turn is over', () => {
  test('a tool call with nothing after it is a turn in flight', () => {
    expect(turnStateOf([cc.prompt, cc.answer, cc.toolUse])).toBe('working')
  })

  test('a tool result is the model being called back, not an ending', () => {
    // The single most common tail on a live session: the tool answered and the model has not yet.
    expect(turnStateOf([cc.toolUse, cc.toolResult])).toBe('working')
  })

  test('prose with no call after it is the turn handed back', () => {
    expect(turnStateOf([cc.toolUse, cc.toolResult, cc.answer])).toBe('idle')
  })

  test("a person's own message is a turn beginning", () => {
    expect(turnStateOf([cc.answer, cc.prompt])).toBe('working')
  })

  test('codex wraps its calls, outputs, and messages in response_item records', () => {
    expect(turnStateOf([codex.prompt, codex.call])).toBe('working')
    expect(turnStateOf([codex.call, codex.output])).toBe('working')
    expect(turnStateOf([codex.call, codex.output, codex.answer])).toBe('idle')
  })

  test('codex says when a turn is over, and that is the last thing it writes', () => {
    // Measured across the 60 newest rollouts of a real history: the final record is `task_complete`
    // in 44 and `turn_aborted` in 7. They arrive as `event_msg`, which this reader used to skip —
    // so it walked back PAST the terminator to the call before it and reported 44 finished
    // sessions as working. A wait on one of them would have run to its timeout.
    expect(turnStateOf([codex.call, codex.output, codexEvent.complete])).toBe('idle')
    expect(turnStateOf([codex.call, codexEvent.aborted])).toBe('idle')
  })

  test('a lifecycle event that is not an ending is skipped, not read as one', () => {
    // `token_count` follows nearly every turn and `sub_agent_activity` interleaves with the calls;
    // treating either as evidence would answer for the wrong moment.
    expect(turnStateOf([codex.call, codexEvent.tokens])).toBe('working')
    expect(turnStateOf([codex.call, codexEvent.activity, codexEvent.tokens])).toBe('working')
    expect(turnStateOf([codexEvent.complete, codexEvent.tokens])).toBe('idle')
  })

  test('codex custom tool calls are also mid-turn evidence', () => {
    expect(turnStateOf([codex.prompt, codex.customCall])).toBe('working')
    expect(turnStateOf([codex.customCall, codex.customOutput])).toBe('working')
  })
})

/** GitHub Copilot events, copied from a real `~/.copilot/session-state/<uuid>/events.jsonl`. */
const copilot = {
  turnStart: { type: 'assistant.turn_start', data: { turnId: '3' } },
  turnEnd: { type: 'assistant.turn_end', data: { turnId: '3' } },
  toolStart: { type: 'tool.execution_start', data: { toolCallId: 'c1', toolName: 'grep' } },
  toolDone: { type: 'tool.execution_complete', data: { toolCallId: 'c1', success: true } },
  prose: { type: 'assistant.message', data: { messageId: 'm1', content: 'Looking.' } },
  ask: { type: 'user.message', data: { content: 'add email sending' } },
  abort: { type: 'abort', data: { reason: 'user interrupt' } },
  shutdown: { type: 'session.shutdown', data: { conversationTokens: 40_000 } },
  subagentFailed: { type: 'subagent.failed', data: { agentId: 'sub1' } },
}

describe('copilot brackets its turns, so the reading is exact', () => {
  /**
   * Measured across 34 real logs: 560 turn_start against 563 turn_end, and as a
   * final record session.shutdown (12), assistant.turn_end (10), abort (8), subagent.failed (2),
   * session.error (2). None of those names matched anything before, so every Copilot delegation
   * kept the manifest's degraded guess — 34 of 34 produced no reading at all; 33 read idle now.
   */
  test('an ended turn is the turn being over', () => {
    expect(turnStateOf([copilot.ask, copilot.turnStart, copilot.turnEnd])).toBe('idle')
  })

  test('a started turn with no end is a turn in flight', () => {
    expect(turnStateOf([copilot.turnStart, copilot.toolStart])).toBe('working')
    expect(turnStateOf([copilot.turnStart, copilot.toolStart, copilot.toolDone])).toBe('working')
  })

  test('an interrupted or shut-down session is not still working', () => {
    // Each stands ALONE over a mid-turn record: with a turn_end beneath them the assertion would
    // pass whether or not either name is recognised.
    expect(turnStateOf([copilot.toolStart, copilot.abort])).toBe('idle')
    expect(turnStateOf([copilot.toolStart, copilot.shutdown])).toBe('idle')
    expect(turnStateOf([copilot.toolStart, { type: 'session.error', data: {} }])).toBe('idle')
  })

  test('a failed sub-agent leaves the parent turn where it was', () => {
    // The child died; the parent is still mid-call, and the record beneath says so.
    expect(turnStateOf([copilot.toolStart, copilot.subagentFailed])).toBe('working')
    expect(turnStateOf([copilot.turnEnd, copilot.subagentFailed])).toBe('idle')
  })

  test("a person's message begins a turn, before any assistant event exists", () => {
    expect(turnStateOf([copilot.turnEnd, copilot.ask])).toBe('working')
  })
})

describe('anything it does not recognise is not evidence', () => {
  test('bookkeeping records are skipped, and the reading comes from what is under them', () => {
    // A summary or a snapshot appended after a tool call must not read as "the turn ended" — that
    // is the one mistake that settles a wait on a working agent.
    expect(turnStateOf([cc.toolUse, cc.summary, cc.snapshot])).toBe('working')
  })

  test('an empty or unreadable tail decides nothing, leaving the degraded state alone', () => {
    expect(turnStateOf([])).toBeUndefined()
    expect(turnStateOf([null, 'not a record', { noType: true }])).toBeUndefined()
  })

  test('a thinking block still ends the turn, because no call followed it', () => {
    expect(turnStateOf([cc.toolResult, cc.thinking])).toBe('idle')
  })
})

describe('a `working` reading expires; an `idle` one does not', () => {
  const NOW = Date.parse('2026-08-07T20:00:00.000Z')

  test('a fresh mid-turn tail is working', () => {
    expect(turnStateAt([cc.toolResult], NOW - 10_000, NOW)).toBe('working')
  })

  test('a stale mid-turn tail is no evidence, not a working agent', () => {
    // A log whose last line is a tool_result and which has not moved for an hour describes an agent
    // that died mid-call. Reporting it as working would hang every `all` wait until its timeout.
    expect(turnStateAt([cc.toolResult], NOW - TURN_EVIDENCE_MS - 1, NOW)).toBeUndefined()
  })

  test('a finished turn stays finished however old the file is', () => {
    expect(turnStateAt([cc.answer], NOW - 30 * 86_400_000, NOW)).toBe('idle')
  })
})
