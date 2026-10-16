import { describe, expect, test } from 'bun:test'
import {
  pruneMessages,
  stripAssetBindings,
  itemResultModelText,
  type PruneRule,
} from './prune-messages'
import type { ChatMessage, MessageAttachment } from '../chat'
import type { ToolBackedItem } from '../agents/items'

// ---- itemResultModelText ------------------------------------------------------

describe('itemResultModelText', () => {
  const item = (over: Partial<ToolBackedItem>): ToolBackedItem => over as unknown as ToolBackedItem

  test('prefers error.userMessage over resultText/errorText', () => {
    expect(
      itemResultModelText(
        item({
          error: { userMessage: 'friendly' },
          resultText: 'r',
          errorText: 'e',
        } as Partial<ToolBackedItem>),
      ),
    ).toBe('friendly')
  })

  test('falls back to resultText, then errorText', () => {
    expect(itemResultModelText(item({ resultText: 'r', errorText: 'e' }))).toBe('r')
    expect(itemResultModelText(item({ errorText: 'e' }))).toBe('e')
  })

  test('empty string when nothing is model-facing', () => {
    expect(itemResultModelText(item({}))).toBe('')
  })
})

// ---- Builders -----------------------------------------------------------------

function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    ...over,
  }
}

function imageAttachment(name: string): MessageAttachment {
  return { kind: 'image', mediaType: 'image/png', data: 'AAAA', name, size: 4 }
}

// ---- stripAssetBindings -------------------------------------------------------

describe('stripAssetBindings', () => {
  test('converts image/file attachments to text placeholders, keeps text attachments', () => {
    const attachments: MessageAttachment[] = [
      { kind: 'image', mediaType: 'image/png', data: 'AAAA', name: 'shot.png', size: 4 },
      { kind: 'file', mediaType: 'application/pdf', data: 'BBBB', name: 'doc.pdf', size: 4 },
      { kind: 'text', name: 'notes.txt', text: 'keep me', size: 7 },
    ]
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'user', content: 'see files', bindings: attachments }),
    ]
    const res = pruneMessages(messages, { rules: [stripAssetBindings()] })
    expect(res.prunedCount).toBe(1)
    const next = res.messages[1].bindings!
    expect(next[0]).toEqual({
      kind: 'text',
      name: 'shot.png',
      text: '[image "shot.png" omitted from history]',
      size: 0,
    })
    expect(next[1]).toEqual({
      kind: 'text',
      name: 'doc.pdf',
      text: '[file "doc.pdf" omitted from history]',
      size: 0,
    })
    // text attachment unchanged (same reference)
    expect(next[2]).toBe(attachments[2])
  })

  test('respects custom kinds (only strip image, keep file)', () => {
    const attachments: MessageAttachment[] = [
      { kind: 'image', mediaType: 'image/png', data: 'AAAA', name: 'a.png', size: 4 },
      { kind: 'file', mediaType: 'application/pdf', data: 'BBBB', name: 'b.pdf', size: 4 },
    ]
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'user', content: 'x', bindings: attachments }),
    ]
    const res = pruneMessages(messages, { rules: [stripAssetBindings({ kinds: ['image'] })] })
    const next = res.messages[1].bindings!
    expect(next[0].kind).toBe('text')
    expect(next[1]).toBe(attachments[1]) // file kept
  })

  test('no attachments → no change', () => {
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'user', content: 'x' }),
    ]
    const res = pruneMessages(messages, { rules: [stripAssetBindings()] })
    expect(res.prunedCount).toBe(0)
    expect(res.messages).toBe(messages)
  })

  test('idempotent: a second run prunes nothing and returns the same reference', () => {
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'user', content: 'x', bindings: [imageAttachment('a.png')] }),
    ]
    const first = pruneMessages(messages, { rules: [stripAssetBindings()] })
    expect(first.prunedCount).toBe(1)
    const second = pruneMessages(first.messages, { rules: [stripAssetBindings()] })
    expect(second.prunedCount).toBe(0)
    expect(second.messages).toBe(first.messages)
  })
})

// ---- Protected window ---------------------------------------------------------

describe('protected window', () => {
  function attMsg(id: string): ChatMessage {
    return msg({ id, role: 'user', content: 'x', bindings: [imageAttachment(`${id}.png`)] })
  }

  test('protectFirst protects messages[0]', () => {
    const messages = [attMsg('first'), msg({ id: 'tail', role: 'user', content: 'else' })]
    // index 0 protected by default; index 1 is the tail (length - 0).
    const res = pruneMessages(messages, { rules: [stripAssetBindings()] })
    expect(res.prunedCount).toBe(0)
    expect(res.messages[0].bindings![0].kind).toBe('image')
  })

  test('protectFirst:false allows pruning index 0 (when not in tail)', () => {
    const messages = [attMsg('first'), msg({ id: 'tail', role: 'user', content: 'x' })]
    const res = pruneMessages(messages, {
      rules: [stripAssetBindings()],
      protectFirst: false,
      keepRecentFromIndex: 1,
    })
    expect(res.prunedCount).toBe(1)
    expect(res.messages[0].bindings![0].kind).toBe('text')
  })

  test('protects indices >= keepRecentFromIndex', () => {
    const messages = [msg({ id: '0', role: 'user', content: 'task' }), attMsg('1'), attMsg('2')]
    const res = pruneMessages(messages, { rules: [stripAssetBindings()], keepRecentFromIndex: 1 })
    expect(res.prunedCount).toBe(0)
    expect(res.messages[1].bindings![0].kind).toBe('image')
    expect(res.messages[2].bindings![0].kind).toBe('image')
  })
})

// ---- Pipeline composition -----------------------------------------------------

describe('pruneMessages pipeline composition', () => {
  test('byRule counts each firing rule; prunedCount counts changed messages', () => {
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'user', content: 'x', bindings: [imageAttachment('a.png')] }),
    ]
    const res = pruneMessages(messages, { rules: [stripAssetBindings()] })
    expect(res.prunedCount).toBe(1)
    expect(res.byRule.stripAssetBindings).toBe(1)
  })

  test('byRule omits rules that never fired', () => {
    const noop: PruneRule = { name: 'noop', apply: () => undefined }
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'user', content: 'x', bindings: [imageAttachment('a.png')] }),
    ]
    const res = pruneMessages(messages, { rules: [stripAssetBindings(), noop] })
    expect(res.byRule.stripAssetBindings).toBe(1)
    expect(res.byRule.noop).toBeUndefined()
  })
})

// ---- keepRecentCount vs keepRecentFromIndex -----------------------------------

describe('keepRecent precedence', () => {
  function attMsg(id: string): ChatMessage {
    return msg({ id, role: 'user', content: 'x', bindings: [imageAttachment(`${id}.png`)] })
  }

  test('keepRecentFromIndex takes precedence over keepRecentCount', () => {
    const messages = [
      msg({ id: '0', role: 'user', content: 'task' }),
      attMsg('1'),
      attMsg('2'),
      attMsg('3'),
      attMsg('4'),
    ]
    // keepRecentCount would protect last 4 (indices 1..4) → 0 pruned.
    // keepRecentFromIndex:4 wins → only index 4 protected; 1,2,3 prunable.
    const res = pruneMessages(messages, {
      rules: [stripAssetBindings()],
      keepRecentCount: 4,
      keepRecentFromIndex: 4,
    })
    expect(res.prunedCount).toBe(3)
    expect(res.messages[4].bindings![0].kind).toBe('image') // tail untouched
    expect(res.messages[1].bindings![0].kind).toBe('text')
  })

  test('keepRecentCount protects the last N when keepRecentFromIndex is absent', () => {
    const messages = [
      msg({ id: '0', role: 'user', content: 'task' }),
      attMsg('1'),
      attMsg('2'),
      attMsg('3'),
      attMsg('4'),
    ]
    // protect last 2 (indices 3,4); index 0 protected; 1,2 prunable.
    const res = pruneMessages(messages, { rules: [stripAssetBindings()], keepRecentCount: 2 })
    expect(res.prunedCount).toBe(2)
    expect(res.messages[3].bindings![0].kind).toBe('image')
    expect(res.messages[4].bindings![0].kind).toBe('image')
  })
})

// ---- Generics -----------------------------------------------------------------

describe('generics preserve extra fields', () => {
  interface PersistedMessage extends ChatMessage {
    sessionId: string
    createdAt: number
  }

  test('extra fields survive a patch', () => {
    const messages: PersistedMessage[] = [
      { id: 'first', role: 'user', content: 'task', sessionId: 's1', createdAt: 1 },
      {
        id: 'm',
        role: 'user',
        content: 'x',
        sessionId: 's1',
        createdAt: 2,
        bindings: [imageAttachment('a.png')],
      },
    ]
    const res = pruneMessages(messages, { rules: [stripAssetBindings()] })
    const patched = res.messages[1]
    expect(patched.sessionId).toBe('s1')
    expect(patched.createdAt).toBe(2)
    expect(patched.bindings![0].kind).toBe('text')
    // type stays PersistedMessage[]
    const _typecheck: PersistedMessage = patched
    void _typecheck
  })
})

// ---- Rule contract sanity -----------------------------------------------------

describe('custom rules', () => {
  test('a rule returning undefined makes no change', () => {
    const noop: PruneRule = { name: 'noop', apply: () => undefined }
    const messages = [
      msg({ id: 'first', role: 'user', content: 'task' }),
      msg({ id: 'm', role: 'assistant', content: 'body' }),
    ]
    const res = pruneMessages(messages, { rules: [noop] })
    expect(res.prunedCount).toBe(0)
    expect(res.messages).toBe(messages)
  })
})
