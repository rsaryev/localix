import { describe, expect, spyOn, test } from 'bun:test'
import type { MessageBinding } from '@/shared/api/contracts'
import { composerBus, type ComposerInsert } from '@/shared/lib/composerBus'
import { clearSubmittedPrompt, restoreFailedSendDraft, sendToNewChat } from './useSendMessage'

describe('failed send draft restoration', () => {
  test('returns text, assets and context refs to the addressed composer', () => {
    const inserts: ComposerInsert[] = []
    const off = composerBus.subscribe((insert) => {
      inserts.push(insert)
      return true
    })
    const bindings = [
      {
        kind: 'text',
        text: 'attached contents',
        name: 'notes.txt',
        size: 17,
      },
      {
        kind: 'context',
        id: 'ref-1',
        source: 'mention',
        target: {
          kind: 'resource',
          token: '@resource:localix://resource/fixture-db/c1',
          label: 'Database',
        },
        resolution: { status: 'pending', contributions: [] },
      },
    ] satisfies MessageBinding[]

    try {
      restoreFailedSendDraft('s1', 'the original prompt', bindings)
    } finally {
      off()
    }

    expect(inserts).toEqual([
      {
        sessionId: 's1',
        text: 'the original prompt',
        bindings,
        buffer: true,
      },
    ])
  })
})

describe('the first message of a composer with no chat yet', () => {
  const harness = () => {
    let prompt = ''
    const cleared: Array<readonly string[] | undefined> = []
    return {
      cleared,
      prompt: () => prompt,
      args: {
        text: 'look at @file:src/a.ts',
        messageBindings: [],
        submittedAttachmentIds: ['att-1'],
        clearAttachments: (ids?: readonly string[]) => void cleared.push(ids),
        setPrompt: (next: string | ((current: string) => string)) => {
          prompt = typeof next === 'function' ? next(prompt) : next
        },
        forceScrollToBottom: () => {},
        goToSession: () => {},
      },
    }
  }

  test('a failed creation keeps the staged files and puts the text back', async () => {
    // No chat exists to address on the composer bus, so restoring through it lost the files and
    // refs; they now stay staged until there is a chat to restore them into.
    const h = harness()
    await sendToNewChat({ ...h.args, createSession: async () => null })
    expect(h.cleared).toEqual([])
    expect(h.prompt()).toBe('look at @file:src/a.ts')
  })

  test('the staged files are unstaged only once the chat exists, and a failed send restores into it', async () => {
    const h = harness()
    let created = false
    // Reject at the send boundary: another suite's WebSocket stub or startup barrier must not
    // decide whether this draft-restoration test ever settles.
    const sending = await import('@/features/chat/model/sendChatMessage')
    const originalSend = sending.sendChatMessage
    const send = spyOn(sending, 'sendChatMessage').mockRejectedValue(new Error('Send failed'))
    // Subscribing first keeps the buffered insert from leaking into a later test's bus.
    const restored: ComposerInsert[] = []
    const off = composerBus.subscribe((insert) => {
      restored.push(insert)
      return true
    })
    try {
      await sendToNewChat({
        ...h.args,
        createSession: async () => {
          expect(h.cleared).toEqual([])
          created = true
          return { id: 'new-chat', projectId: null }
        },
      })
      expect(send).toHaveBeenCalledWith('new-chat', h.args.text, {
        bindings: undefined,
        isInternal: undefined,
      })
    } finally {
      off()
      send.mockRestore()
      expect(sending.sendChatMessage).toBe(originalSend)
    }
    expect(created).toBe(true)
    expect(h.cleared).toEqual([['att-1']])
    expect(restored.map((insert) => insert.sessionId)).toEqual(['new-chat'])
  })
})

describe('submitted draft cleanup', () => {
  test('clears only the prompt snapshot that was actually submitted', () => {
    expect(clearSubmittedPrompt('submitted', 'submitted')).toBe('')
    expect(clearSubmittedPrompt('new draft typed during preflight', 'submitted')).toBe(
      'new draft typed during preflight',
    )
  })
})
