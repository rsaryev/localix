import { describe, expect, test } from 'bun:test'
import { applyPlan, POINTER_PLACEHOLDER } from './apply'
import type { CompressionPlan } from './plan'
import { ELISION_MARKER, type Operation } from './op-menu'
import type { ChatMessage } from '../chat'
import type { AgentItem } from '../agents/items'

// A completed, non-recoverable tool_call item (name is not read/write/edit/patch,
// so elideItem leaves it for the lossy rewrite to handle).
const toolItem = (resultText: string): AgentItem =>
  ({
    id: 'i1',
    status: 'completed',
    type: 'tool_call',
    toolCallId: 'tc1',
    name: 'shell_exec',
    activeVerb: 'Running',
    resultText,
  }) as unknown as AgentItem

const msg = (item: AgentItem): ChatMessage =>
  ({ role: 'assistant', content: '', items: [item] }) as ChatMessage

const plan = (op: Operation): CompressionPlan => ({
  assignment: [{ index: 0, op }],
  estTokensBefore: 0,
  estTokensAfter: 0,
  budget: 0,
})

const op = (kind: Operation['kind'], extra: Partial<Operation> = {}): Operation =>
  ({ kind, cost: 0, ...extra }) as Operation

const resultOf = (m: ChatMessage) =>
  (m.items?.[0] as { resultText?: string } | undefined)?.resultText ?? ''

describe('applyPlan', () => {
  test('verbatim leaves the message reference untouched', () => {
    const m = msg(toolItem('x'.repeat(200)))
    const out = applyPlan([m], plan(op('verbatim')))
    expect(out[0]).toBe(m) // unchanged reference
  })

  test('a plan that changes nothing returns the same array', () => {
    const messages = [msg(toolItem('x'.repeat(200))), msg(toolItem('y'))]
    expect(applyPlan(messages, plan(op('verbatim')))).toBe(messages)
  })

  test('a changed message is a new object that keeps its other fields', () => {
    const m = { ...msg(toolItem('a'.repeat(500))), id: 'm1', extra: 1 } as ChatMessage
    const messages = [m]
    const out = applyPlan(messages, plan(op('pointer')))
    expect(out).not.toBe(messages)
    expect(out[0]).not.toBe(m)
    expect(out[0]).toMatchObject({ id: 'm1', extra: 1, role: 'assistant' })
  })

  test('pointer replaces the result with a placeholder carrying a recovery handle', () => {
    const item = toolItem('a'.repeat(500))
    const out = applyPlan([msg(item)], plan(op('pointer')))
    const text = resultOf(out[0])
    expect(text).toContain(ELISION_MARKER)
    // Non-recoverable output has no disk copy: without the handle the model's only
    // recovery is re-running the command.
    expect(text).toContain('ToolOutput(action="get", tool_call_id="tc1")')
  })

  test('pointer falls back to the bare placeholder when there is no tool_call_id', () => {
    const item = { ...toolItem('a'.repeat(500)), toolCallId: '' }
    const out = applyPlan([msg(item)], plan(op('pointer')))
    expect(resultOf(out[0])).toBe(POINTER_PLACEHOLDER)
  })

  test('pointer never advertises a recovery tool absent from the effective roster', () => {
    const out = applyPlan([msg(toolItem('a'.repeat(500)))], plan(op('pointer')), {
      recoveryToolAvailable: false,
    })
    const text = resultOf(out[0])
    expect(text).toContain(ELISION_MARKER)
    expect(text).not.toContain('ToolOutput')
    expect(text).toContain('full original is unavailable in this run')
  })

  test('truncate keeps a head+tail split with an elision marker', () => {
    const full = 'HEAD' + 'x'.repeat(200) + 'TAIL'
    const out = applyPlan([msg(toolItem(full))], plan(op('truncate', { truncateChars: 40 })))
    const text = resultOf(out[0])
    expect(text.length).toBeLessThan(full.length)
    expect(text).toContain('elided to save context')
    expect(text.startsWith('HEAD')).toBe(true)
    expect(text.trimEnd().endsWith('TAIL')).toBe(true)
  })

  test('oneline collapses to a first…last summary', () => {
    const out = applyPlan([msg(toolItem('first line\nmid\nmid2\nlast line'))], plan(op('oneline')))
    const text = resultOf(out[0])
    expect(text).toContain('first line')
    expect(text).toContain('last line')
    expect(text.length).toBeLessThan('first line\nmid\nmid2\nlast line'.length + 90)
  })

  test('preserves item identity (id/toolCallId/name/status/type) when rewriting', () => {
    const out = applyPlan([msg(toolItem('y'.repeat(300)))], plan(op('pointer')))
    expect(out[0].items?.[0]).toMatchObject({
      id: 'i1',
      toolCallId: 'tc1',
      name: 'shell_exec',
      status: 'completed',
      type: 'tool_call',
    })
  })

  test('idempotent: already-elided output is not re-compressed', () => {
    const already = 'stuff [output elided to save context — 999 chars]'
    const m = msg(toolItem(already))
    const out = applyPlan([m], plan(op('truncate', { truncateChars: 5 })))
    expect(resultOf(out[0])).toBe(already)
  })

  test('a non-completed item is left untouched', () => {
    const running = {
      id: 'i',
      status: 'running',
      type: 'tool_call',
      toolCallId: 't',
      name: 'shell_exec',
      activeVerb: 'Running',
      resultText: 'z'.repeat(300),
    } as unknown as AgentItem
    const out = applyPlan([msg(running)], plan(op('pointer')))
    expect(resultOf(out[0])).toBe('z'.repeat(300))
  })
})
