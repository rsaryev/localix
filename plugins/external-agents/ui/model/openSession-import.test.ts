import { describe, expect, spyOn, test } from 'bun:test'
import { toast } from '@localixai/plugin-sdk/ui'
import type {
  PluginConversationImport,
  PluginTranscriptInput,
} from '@localixai/plugin-sdk/ui/runtime'

import {
  importExternalAgentSession,
  openExternalAgentSession,
  type ExternalAgentSessionSource,
} from './openSession'
import { MAX_TRANSCRIPT_EVENTS } from '../../shared/contracts'

const source = (cwd?: string): ExternalAgentSessionSource => ({
  provider: 'claude-code',
  nativeSessionId: 'foreign-1',
  key: 'claude-code:foreign-1',
  uri: 'localix://resource/external-agent/claude-code/foreign-1',
  title: 'Foreign session',
  ...(cwd ? { cwd } : {}),
})

const items = async () => ({
  key: 'claude-code:foreign-1',
  turns: [
    {
      role: 'user' as const,
      items: [{ id: 'text-1', type: 'text' as const, status: 'completed' as const, text: 'Hello' }],
    },
  ],
  withheld: 0,
  total: 1,
})

describe('an import is durable, so what it leaves out it must name', () => {
  /**
   * Import mints a Localix session titled after the external one. It used to take the READ's default
   * of 400 events: measured on a real local history, that carried 11.6%–13.3% of a long session — 400 of
   * 3462 events became 4 messages — and nothing anywhere said so.
   */
  test('the whole session is requested, not the preview-sized default', async () => {
    const asked: [number | undefined, boolean | undefined][] = []
    await importExternalAgentSession(source(), {
      items: async (_key, maxEvents, tail) => {
        asked.push([maxEvents, tail])
        return items()
      },
      resolveProjectByPath: async () => ({ id: 'p' }),
      importSession: async () => ({ id: 'LOCALIX-1' }) as never,
    })
    // The wire ceiling, not 400 and not unbounded: core's import bound is what protects the write.
    // From the END, because a session past that ceiling loses its recent half otherwise — measured
    // in a real local history, 10 of 230 sessions exceed it and those ten hold 30.6% of every recorded event.
    expect(asked).toEqual([[MAX_TRANSCRIPT_EVENTS, true]])
  })

  test('a truncated import OPENS with a note naming the counts and where the rest is', async () => {
    let imported: PluginConversationImport | undefined
    await importExternalAgentSession(source(), {
      items: async () => ({ ...(await items()), withheld: 3062, total: 3462 }),
      resolveProjectByPath: async () => ({ id: 'p' }),
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-2' } as never
      },
    })

    // FIRST, not last: it describes what follows rather than where the reading stopped, and a window
    // onto the end of a session begins mid-work.
    const note = imported?.messages[0]
    expect(note?.content).toContain('LAST 400 of 3,462')
    expect(note?.content).toContain('3,062')
    // The remainder stays reachable: the note names the key and how to read the far end — which is
    // now the OPENING, since the import already holds the end.
    expect(note?.content).toContain('claude-code:foreign-1')
    expect(note?.content).not.toContain('tail: true')
    expect(imported?.messages.at(-1)?.content).toBe('Hello')
  })

  test('the preview a reader opens is bounded and disclosed the same way', async () => {
    // The preview is the surface a person actually looks at, and it took the same 400-event default.
    // Raising it is free — the adapter already walks the source to compute `total`, so 400 events and
    // 2000 measured 52 ms and 53 ms on one session.
    const asked: [number | undefined, boolean | undefined][] = []
    let transcript: PluginTranscriptInput | undefined
    await openExternalAgentSession(
      'chat-a',
      source(),
      async (_key, maxEvents, tail) => {
        asked.push([maxEvents, tail])
        return { ...(await items()), withheld: 3062, total: 3462 }
      },
      async () => ({ id: 'LOCALIX-5', projectId: 'PRJ-default' }),
      (input) => {
        transcript = input
      },
    )

    expect(asked).toEqual([[MAX_TRANSCRIPT_EVENTS, true]])
    // The transcript tab opens in the roster's own chat — the host refuses one that names none.
    expect(transcript?.sessionId).toBe('chat-a')
    const note = transcript?.messages[0]
    expect(note?.content).toContain('LAST 400 of 3,462')
  })

  test('a source the adapter cut short says which END it holds, not a count', async () => {
    // `total` counts only what fitted, so "the LAST 400 of 3,462" would be a position in the read
    // rather than in the session. The END is still knowable: this path asks for the tail, and a tail
    // read of an oversized file reads backwards to the session's last turn.
    let imported: PluginConversationImport | undefined
    await importExternalAgentSession(source(), {
      items: async () => ({
        ...(await items()),
        withheld: 8591,
        total: 8596,
        sourceTruncated: true,
        readFrom: 'tail' as const,
      }),
      resolveProjectByPath: async () => ({ id: 'p' }),
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-9' } as never
      },
    })

    const note = imported?.messages[0]
    expect(note?.content).toContain('LATEST turns')
    // "only in the agent's own history" was true until `from` existed; the note names the way in.
    expect(note?.content).toContain('from: 0')
    expect(note?.content).toContain('claude-code:foreign-1')
    // The claim this replaced was "NOT the end of it", which the backward tail read made false.
    expect(note?.content).not.toContain('NOT the end')
    expect(note?.content).not.toContain('8,596')
  })

  test('when a head and a tail read would meet, the note points at the opening', async () => {
    // 3,462 events read 2,000 at a time: the two ends overlap, so the opening IS the remainder.
    let imported: PluginConversationImport | undefined
    await importExternalAgentSession(source(), {
      items: async () => ({ ...(await items()), withheld: 1462, total: 3462 }),
      resolveProjectByPath: async () => ({ id: 'p' }),
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-7' } as never
      },
    })

    const note = imported?.messages[0]
    expect(note?.content).toContain("read the session's opening")
    expect(note?.content).not.toContain('from: 0')
  })

  test('when they would NOT meet, it names the walk instead of the opening', async () => {
    // 8,596 events read 2,000 at a time leaves 4,596 that neither end reaches. Four sessions on this
    // machine are in that band.
    let imported: PluginConversationImport | undefined
    await importExternalAgentSession(source(), {
      items: async () => ({ ...(await items()), withheld: 6596, total: 8596 }),
      resolveProjectByPath: async () => ({ id: 'p' }),
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-8' } as never
      },
    })

    const note = imported?.messages[0]
    expect(note?.content).toContain('walk it a window at a time')
    expect(note?.content).toContain('from: 0')
    expect(note?.content).toContain('raising `from` by 2,000')
    expect(note?.content).not.toContain("session's opening")
  })

  test('a complete import gets no note, because there is nothing to disclose', async () => {
    let imported: PluginConversationImport | undefined
    await importExternalAgentSession(source(), {
      items,
      resolveProjectByPath: async () => ({ id: 'p' }),
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-3' } as never
      },
    })
    expect(imported?.messages).toHaveLength(1)
    expect(imported?.messages.at(-1)?.content).toBe('Hello')
  })
})

describe('external session import scope', () => {
  test('resolves the foreign cwd to a durable Localix project and imports into that scope', async () => {
    let resolvedPath: string | undefined
    let imported: PluginConversationImport | undefined

    const importedSession = await importExternalAgentSession(source('/work/acme'), {
      items,
      resolveProjectByPath: async (path) => {
        resolvedPath = path
        return { id: 'project-acme' }
      },
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-42', projectId: 'project-acme' } as never
      },
    })

    expect(importedSession).toEqual({ id: 'LOCALIX-42', projectId: 'project-acme' })
    expect(resolvedPath).toBe('/work/acme')
    expect(imported?.projectId).toBe('project-acme')
    expect(imported?.messages[0]?.content).toBe('Hello')
  })

  test('does not invent a project when the provider recorded no cwd', async () => {
    let imported: PluginConversationImport | undefined

    // Core still files the session somewhere — its default project — and THAT is what the
    // caller is handed back, so the reveal lands where the session actually is.
    const result = await importExternalAgentSession(source(), {
      items,
      resolveProjectByPath: async () => {
        throw new Error('cwd resolver must stay dormant')
      },
      importSession: async (input) => {
        imported = input
        return { id: 'LOCALIX-43', projectId: 'PRJ-default' } as never
      },
    })

    expect(imported).not.toHaveProperty('projectId')
    expect(result).toEqual({ id: 'LOCALIX-43', projectId: 'PRJ-default' })
  })

  test('the read-only preview exposes import as its one durable footer action', async () => {
    const success = spyOn(toast, 'success').mockReturnValue('import-toast')
    let transcript: PluginTranscriptInput | undefined
    try {
      await openExternalAgentSession(
        'chat-a',
        source('/work/acme'),
        items,
        async () => ({
          id: 'LOCALIX-44',
          projectId: 'project-acme',
        }),
        (input) => {
          transcript = input
        },
      )

      expect(transcript?.action?.label).toBe('Import session')
      expect(transcript?.action?.pendingLabel).toBe('Importing…')
      expect(transcript?.action?.description).toContain('/work/acme')
      const destination = await transcript?.action?.run()
      expect(destination).toEqual({
        sessionId: 'LOCALIX-44',
        projectId: 'project-acme',
      })
      // The host navigates to the destination; a success row would only repeat that.
      expect(success).not.toHaveBeenCalled()
    } finally {
      success.mockRestore()
    }
  })
})
