import { describe, expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import { applyStreamEventToSession } from '@/shared/api/applyStreamEvent'
import { createTranscriptProjectionSelector } from '../ui/transcriptProjection'
import { mergeSessionBody } from './mergeSessionBody'
import { systemNotices } from './systemNotices'

// Minimal sessions covering only the fields the merge reads — same stance as
// the applyStreamEvent tests (cast through unknown).
const sess = (over: Partial<UiSession> = {}): UiSession =>
  ({ id: 'sess-1', messages: [], isRunning: false, ...over }) as unknown as UiSession

const msg = (over: Record<string, unknown>) => over as never

describe('mergeSessionBody — whole-body replaces must not wipe in-flight state', () => {
  test('no prev returns next untouched (same ref)', () => {
    const next = sess()
    expect(mergeSessionBody(undefined, next)).toBe(next)
  })

  test('a root detail’s plans REPLACE a stale list; a body without them keeps it', () => {
    // The stored list had missed the frame that approved v1 and was carried over
    // every refetch, so the strip offered Approve forever. The detail is the authority.
    const stale = [{ id: 'p1', status: 'presented' }] as never
    const fresh = [{ id: 'p1', status: 'approved' }] as never
    expect(mergeSessionBody(sess({ plans: stale }), sess({ plans: fresh })).plans).toBe(fresh)
    expect(mergeSessionBody(sess({ plans: stale }), sess({ plans: [] })).plans).toEqual([])
    // A child's detail, or one whose plans could not be read, does not carry them: "unknown"
    // keeps the list (dropping it hid the strip until a remount).
    expect(mergeSessionBody(sess({ plans: stale }), sess({ bodyLoaded: true })).plans).toBe(stale)
    // A workspace summary never carries them either.
    const summary = sess({ bodyLoaded: false })
    expect(mergeSessionBody(sess({ plans: stale, bodyLoaded: true }), summary).plans).toBe(stale)
  })

  test('a detail replace keeps the LSP diagnostics only the live stream delivers', () => {
    // The converters seed `lspDiagnostics: {}` — the server never sends them in a body — so every
    // reconcile, watchdog refetch or permission change emptied the Problems panel and the editor
    // squiggles until the language server happened to publish that file again.
    const diagnostics = { '/repo/a.ts': [{ message: 'x is unused' }] } as never
    const merged = mergeSessionBody(
      sess({ lspDiagnostics: diagnostics }),
      sess({ bodyLoaded: true, lspDiagnostics: {} }),
    )
    expect(merged.lspDiagnostics).toBe(diagnostics)
    // A body that does carry diagnostics is not overridden by the stored copy.
    const fresh = { '/repo/b.ts': [] } as never
    expect(
      mergeSessionBody(sess({ lspDiagnostics: diagnostics }), sess({ lspDiagnostics: fresh }))
        .lspDiagnostics,
    ).toBe(fresh)
  })

  test('a workspace summary updates metadata without erasing a loaded transcript', () => {
    const detailOnly = [{ request: { id: 'ask-1' } }] as never
    const prev = sess({
      title: 'Old title',
      bodyLoaded: true,
      pendingInteractionQueue: detailOnly,
      messages: [msg({ id: 'u1', role: 'user', content: 'persisted' })],
    })
    const summary = sess({
      title: 'Fresh title',
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
      bodyLoaded: false,
      pendingInteractionQueue: [],
      messages: [],
    })

    const merged = mergeSessionBody(prev, summary)
    expect(merged.title).toBe('Fresh title')
    expect(merged.externalAgentProvider).toBe('codex')
    expect(merged.externalAgentSessionKey).toBe('codex:native')
    expect(merged.messages.map((message) => message.id)).toEqual(['u1'])
    expect(merged.pendingInteractionQueue).toBe(detailOnly)
    expect(merged.bodyLoaded).toBe(true)
  })

  test('carries client-only system notices forward', () => {
    // Built by the REAL producer, not hand-written: the carry keys on the `clientOnly`
    // marker `systemNoticeMessage` stamps, and a fabricated `{role:'system'}` fixture
    // would pass against a merge that no longer carries anything.
    const notice = systemNotices.connectionChange('My Key')
    const prev = sess({ messages: [msg({ id: 'm1', role: 'user' }), notice] } as never)
    const next = sess({ messages: [msg({ id: 'm1', role: 'user' })] } as never)
    const merged = mergeSessionBody(prev, next)
    expect(merged.messages.map((m) => m.id)).toEqual(['m1', notice.id])
  })

  test('a PERSISTED system row in the body no longer deletes the client-only notices', () => {
    // The defect: the guard was "does the body hold ANY system row?", and `toUiMessage`
    // projects every persisted `systemNotice`/`commandOutput` row to `role: 'system'`.
    // The backend persists a `mode_change` on each `/mode` switch, so one switch — or one
    // slash command — silently deleted "Model changed to …" on every later replace.
    const notice = systemNotices.connectionChange('My Key')
    const persistedModeChange = msg({
      id: 'db-uuid-1',
      role: 'system',
      systemNotice: { kind: 'mode_change', tone: 'muted', text: 'Mode changed to plan' },
    })
    const prev = sess({
      messages: [persistedModeChange, msg({ id: 'm1', role: 'user' }), notice],
    } as never)
    const next = sess({ messages: [persistedModeChange, msg({ id: 'm1', role: 'user' })] } as never)
    const merged = mergeSessionBody(prev, next)
    expect(merged.messages.map((m) => m.id)).toEqual(['db-uuid-1', 'm1', notice.id])
  })

  test('the same notice is not carried twice when the body already holds that row', () => {
    const notice = systemNotices.connectionChange('My Key')
    const prev = sess({ messages: [notice] } as never)
    const next = sess({ messages: [notice] } as never)
    expect(mergeSessionBody(prev, next).messages.map((m) => m.id)).toEqual([notice.id])
  })

  test('a live ACTIVE wait is never carried — the body is the authority on live waits', () => {
    // Both directions of the same rule. `toUiSession` re-derives one
    // `terminal-wait-snapshot-<terminalId>` row per wait `detail.terminalWaits` still reports, so
    // carrying the client's copy either duplicates the wait (body still lists it) or resurrects one
    // the body says has ended (body no longer lists it). `terminal.waiting` is live-only, so the
    // settle frame that arrived while the socket was down is never replayed to correct it.
    const live = msg({
      id: 'sys-terminal-waiting-1',
      role: 'system',
      clientOnly: true,
      systemNotice: { kind: 'terminal_activity', tone: 'muted', text: 'Waiting' },
      terminalLifecycle: { kind: 'waiting', terminalId: 'pty-1', active: true, count: 1 },
    })
    const snapshot = msg({
      id: 'terminal-wait-snapshot-pty-1',
      role: 'system',
      systemNotice: { kind: 'terminal_activity', tone: 'muted', text: 'Waiting' },
      terminalLifecycle: { kind: 'waiting', terminalId: 'pty-1', active: true, count: 1 },
    })
    // Body still reports the wait → exactly one row, the body's.
    expect(
      mergeSessionBody(
        sess({ messages: [live] } as never),
        sess({ messages: [snapshot] } as never),
      ).messages.map((m) => m.id),
    ).toEqual(['terminal-wait-snapshot-pty-1'])

    // Body no longer reports it → the wait is OVER. Keeping the client's row here would leave the
    // status line stuck on "Waiting for background terminal" for the rest of the session.
    expect(
      mergeSessionBody(
        sess({ messages: [live] } as never),
        sess({ messages: [msg({ id: 'u1', role: 'user' })] } as never),
      ).messages.map((m) => m.id),
    ).toEqual(['u1'])
  })

  test('a SUMMARY body cannot deny a wait — it carries no messages and no waits', () => {
    // `hydrateWorkspace` merges `toUiSessionSummary` bodies (`messages: []`) for every session but
    // the active one. Reading that as "the wait ended" deleted a background session's only record of
    // it on any workspace reload — a message edit or delete triggers one — and nothing re-minted it.
    const live = msg({
      id: 'sys-terminal-waiting-1',
      role: 'system',
      clientOnly: true,
      systemNotice: { kind: 'terminal_activity', tone: 'muted', text: 'Waiting' },
      terminalLifecycle: { kind: 'waiting', terminalId: 'pty-9', active: true, count: 1 },
    })
    const summary = sess({ messages: [] })
    const merged = mergeSessionBody(sess({ messages: [live] } as never), summary)
    expect(merged.messages.map((m) => m.id)).toEqual(['sys-terminal-waiting-1'])
    // A DETAIL body that reports no wait still ends it — that distinction is the whole point.
    expect(
      mergeSessionBody(
        sess({ messages: [live] } as never),
        sess({ messages: [msg({ id: 'u1', role: 'user' })] } as never),
      ).messages.map((m) => m.id),
    ).toEqual(['u1'])
  })

  test('a SETTLED terminal row survives, so an exit seen live is not lost', () => {
    const settled = msg({
      id: 'sys-terminal-finished-1',
      role: 'system',
      clientOnly: true,
      systemNotice: { kind: 'terminal_activity', tone: 'muted', text: 'Waited' },
      terminalLifecycle: { kind: 'finished', terminalId: 'pty-1', count: 3 },
    })
    const merged = mergeSessionBody(
      sess({ messages: [settled] } as never),
      sess({ messages: [msg({ id: 'u1', role: 'user' })] } as never),
    )
    expect(merged.messages.map((m) => m.id)).toEqual(['u1', 'sys-terminal-finished-1'])
    // The fold count survives with it — the body has no equivalent to reconstruct.
    expect(merged.messages[1]?.terminalLifecycle?.count).toBe(3)
  })

  test('a live row for a DIFFERENT terminal still survives the snapshot', () => {
    const live = msg({
      id: 'sys-terminal-finished-1',
      role: 'system',
      clientOnly: true,
      systemNotice: { kind: 'terminal_activity', tone: 'muted', text: 'Waited' },
      terminalLifecycle: { kind: 'finished', terminalId: 'pty-2', count: 1 },
    })
    const snapshot = msg({
      id: 'terminal-wait-snapshot-pty-1',
      role: 'system',
      terminalLifecycle: { kind: 'waiting', terminalId: 'pty-1', active: true, count: 1 },
    })
    const merged = mergeSessionBody(
      sess({ messages: [live] } as never),
      sess({ messages: [snapshot] } as never),
    )
    expect(merged.messages.map((m) => m.id)).toEqual([
      'terminal-wait-snapshot-pty-1',
      'sys-terminal-finished-1',
    ])
  })

  test('a hook warning built by the REAL reducer survives a replace', () => {
    // The seam a review found untested: the marker is stamped inside `applyStreamEvent`, and every
    // test here hand-wrote `clientOnly: true` — so deleting that line from the producer left the
    // whole suite green while a hook warning silently went back to being deleted every 15s.
    const live = applyStreamEventToSession(
      sess({ messages: [msg({ id: 'u1', role: 'user' })] } as never),
      {
        type: 'hook.notice',
        sessionId: 'sess-1',
        message: 'blocked write to .env',
        hookEvent: 'PreToolUse',
      } as never,
    )
    const notice = live.messages.find((m) => m.systemNotice?.kind === 'hook_notice')
    expect(notice).toBeDefined()

    const merged = mergeSessionBody(live, sess({ messages: [msg({ id: 'u1', role: 'user' })] }))
    expect(merged.messages.map((m) => m.id)).toEqual(['u1', notice!.id])
  })

  test('a terminal row built by the REAL reducer survives a replace once it has settled', () => {
    let live = applyStreamEventToSession(sess({ messages: [msg({ id: 'u1', role: 'user' })] }), {
      type: 'terminal.waiting',
      sessionId: 'sess-1',
      terminalId: 'pty-1',
      active: true,
      label: 'prompt',
    } as never)
    // While the wait is LIVE the body owns it, so the client's row is not carried.
    expect(
      mergeSessionBody(live, sess({ messages: [msg({ id: 'u1', role: 'user' })] })).messages.map(
        (m) => m.id,
      ),
    ).toEqual(['u1'])

    live = applyStreamEventToSession(live, {
      type: 'terminal.finished',
      sessionId: 'sess-1',
      terminalId: 'pty-1',
      exitCode: 0,
    } as never)
    // `terminal.finished` does not remove the waiting row — it flips it to `active: false` and
    // rewrites it to "Waited for background terminal". So BOTH rows are settled records now, and
    // both must survive: this is the pair that tells the user the PTY ran and exited while away.
    const carried = live.messages.filter((m) => m.terminalLifecycle).map((m) => m.id)
    expect(carried).toHaveLength(2)
    const merged = mergeSessionBody(live, sess({ messages: [msg({ id: 'u1', role: 'user' })] }))
    expect(merged.messages.map((m) => m.id)).toEqual(['u1', ...carried])
    expect(merged.messages.every((m) => !m.terminalLifecycle?.active)).toBe(true)
  })

  test('a persisted notice trimmed out of the body is NOT resurrected at the tail', () => {
    // Intentional narrowing. A persisted row has no `afterMessageId`, so re-appending it
    // put it BELOW rows that came after it, while the rest of the trimmed conversation
    // stayed absent. Absent is the consistent answer.
    const prev = sess({
      messages: [
        msg({ id: 'db-old-notice', role: 'system', systemNotice: { kind: 'mode_change' } }),
        msg({ id: 'm-recent', role: 'user' }),
      ],
    } as never)
    const next = sess({ messages: [msg({ id: 'm-recent', role: 'user' })] } as never)
    expect(mergeSessionBody(prev, next).messages.map((m) => m.id)).toEqual(['m-recent'])
  })

  test('carries an un-claimed optimistic pair through a reconcile mid-prefill', () => {
    // The 15s idle watchdog refetches EXACTLY during a long prefill — the body
    // predates the send, so the placeholders must survive the replace.
    const prev = sess({
      isRunning: true,
      streamingMessageId: 'optimistic-assistant-1',
      activePhase: { id: 'generating-title', label: 'Generating title…' },
      messages: [
        msg({ id: 'm-old', role: 'assistant', content: 'done' }),
        msg({ id: 'optimistic-user-1', role: 'user', content: 'hi', optimistic: true }),
        msg({ id: 'optimistic-assistant-1', role: 'assistant', items: [], optimistic: true }),
      ],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [msg({ id: 'm-old', role: 'assistant', content: 'done' })],
    } as never)
    const merged = mergeSessionBody(prev, next)
    expect(merged.messages.map((m) => m.id)).toEqual([
      'm-old',
      'optimistic-user-1',
      'optimistic-assistant-1',
    ])
    expect(merged.streamingMessageId).toBe('optimistic-assistant-1')
  })

  test('drops a placeholder whose persisted echo already landed in the body', () => {
    // The fetch can race the stream: the body may carry the persisted user row
    // before the message.created echo claims the placeholder — keeping both
    // would show the message twice.
    const prev = sess({
      isRunning: true,
      messages: [msg({ id: 'optimistic-user-1', role: 'user', content: 'hi', optimistic: true })],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [msg({ id: 'm-real-user', role: 'user', content: 'hi' })],
    } as never)
    const merged = mergeSessionBody(prev, next)
    expect(merged.messages.map((m) => m.id)).toEqual(['m-real-user'])
    expect(merged.messages[0]?.renderKey).toBe('optimistic-user-1')
  })

  test('rebinds the stream target when a fetched assistant echo claims its skeleton', () => {
    const prev = sess({
      isRunning: true,
      streamingMessageId: 'optimistic-assistant-1',
      activePhase: { id: 'generating-title', label: 'Generating title…' },
      messages: [
        msg({ id: 'm-user', role: 'user', content: 'hi' }),
        msg({ id: 'optimistic-assistant-1', role: 'assistant', items: [], optimistic: true }),
      ],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [
        msg({ id: 'm-user', role: 'user', content: 'hi' }),
        msg({ id: 'm-real-assistant', role: 'assistant', items: [] }),
      ],
    } as never)

    const merged = mergeSessionBody(prev, next)

    expect(merged.messages.map((message) => message.id)).toEqual(['m-user', 'm-real-assistant'])
    expect(
      merged.messages.find((message) => message.id === merged.streamingMessageId),
    ).toMatchObject({
      id: 'm-real-assistant',
      role: 'assistant',
      renderKey: 'optimistic-assistant-1',
    })
    expect(merged.activePhase).toEqual({ id: 'generating-title', label: 'Generating title…' })
  })

  test('targets the latest assistant when reconcile observes a continued run', () => {
    // A steer or auto-compact can finish the first assistant segment and start a
    // fresh one before the client reconnects. The original skeleton is claimed
    // by segment 1, but the live phase belongs to the final assistant segment.
    const prev = sess({
      isRunning: true,
      streamingMessageId: 'optimistic-assistant-1',
      activePhase: { id: 'thinking', label: 'Thinking' },
      messages: [
        msg({
          id: 'optimistic-user-1',
          role: 'user',
          content: 'start',
          optimistic: true,
        }),
        msg({
          id: 'optimistic-assistant-1',
          role: 'assistant',
          items: [],
          optimistic: true,
        }),
      ],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [
        msg({ id: 'm-real-user', role: 'user', content: 'start' }),
        msg({ id: 'assistant-part-1', role: 'assistant', content: 'First part' }),
        msg({ id: 'm-steer', role: 'user', content: 'Continue differently' }),
        msg({ id: 'assistant-part-2', role: 'assistant', items: [] }),
      ],
    } as never)

    const merged = mergeSessionBody(prev, next)

    expect(merged.messages.map((message) => message.id)).toEqual([
      'm-real-user',
      'assistant-part-1',
      'm-steer',
      'assistant-part-2',
    ])
    expect(merged.streamingMessageId).toBe('assistant-part-2')
    expect(merged.activePhase).toEqual({ id: 'thinking', label: 'Thinking' })
  })

  test('exact correlation preserves the other identical optimistic message', () => {
    const prev = sess({
      isRunning: true,
      messages: [
        msg({
          id: 'optimistic-user-1',
          role: 'user',
          content: 'same',
          optimistic: true,
        }),
        msg({
          id: 'optimistic-user-2',
          role: 'user',
          content: 'same',
          optimistic: true,
        }),
      ],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [
        msg({
          id: 'm-real-user-2',
          role: 'user',
          content: 'same',
          clientMessageIds: ['optimistic-user-2'],
        }),
      ],
    } as never)
    const merged = mergeSessionBody(prev, next)

    expect(merged.messages.map((m) => m.id)).toEqual(['m-real-user-2', 'optimistic-user-1'])
    expect(merged.messages[0]?.renderKey).toBe('optimistic-user-2')
  })

  test('a fetched echo rebinds notices anchored to its optimistic placeholder', () => {
    const project = createTranscriptProjectionSelector()
    let prev = sess({
      isRunning: true,
      messages: [
        msg({ id: 'assistant-live', role: 'assistant', content: 'streaming' }),
        msg({ id: 'optimistic-user-a', role: 'user', content: 'A', optimistic: true }),
      ],
    } as never)
    prev = applyStreamEventToSession(prev, {
      type: 'terminal.input',
      sessionId: 'sess-1',
      terminalId: 'pty-fetch-claim',
      source: 'user',
      label: 'waiting',
    } as never)
    const noticeId = prev.messages.at(-1)!.id
    prev = {
      ...prev,
      messages: [
        ...prev.messages,
        msg({ id: 'optimistic-user-b', role: 'user', content: 'B', optimistic: true }),
      ],
    }
    const keysBefore = project(prev.messages).map((message) => message.renderKey ?? message.id)

    const merged = mergeSessionBody(
      prev,
      sess({
        isRunning: true,
        messages: [
          msg({ id: 'assistant-live', role: 'assistant', content: 'streaming' }),
          msg({
            id: 'm-real-a',
            role: 'user',
            content: 'A',
            clientMessageIds: ['optimistic-user-a'],
          }),
        ],
      } as never),
    )

    expect(merged.messages.find((message) => message.id === noticeId)?.afterMessageId).toBe(
      'm-real-a',
    )
    expect(project(merged.messages).map((message) => message.id)).toEqual([
      'assistant-live',
      'm-real-a',
      noticeId,
      'optimistic-user-b',
    ])
    expect(project(merged.messages).map((message) => message.renderKey ?? message.id)).toEqual(
      keysBefore,
    )
  })

  test('a combined queued echo supersedes every correlated optimistic row', () => {
    const prev = sess({
      isRunning: true,
      messages: [
        msg({ id: 'optimistic-user-1', role: 'user', content: 'A', optimistic: true }),
        msg({
          id: 'notice-1',
          role: 'system',
          clientOnly: true,
          afterMessageId: 'optimistic-user-1',
        }),
        msg({ id: 'optimistic-user-2', role: 'user', content: 'B', optimistic: true }),
        msg({
          id: 'notice-2',
          role: 'system',
          clientOnly: true,
          afterMessageId: 'optimistic-user-2',
        }),
      ],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [
        msg({
          id: 'm-real-band',
          role: 'user',
          content: 'A\n\n---\n\nB',
          clientMessageIds: ['optimistic-user-1', 'optimistic-user-2'],
        }),
      ],
    } as never)
    const merged = mergeSessionBody(prev, next)

    expect(merged.messages.map((m) => m.id)).toEqual(['m-real-band', 'notice-1', 'notice-2'])
    expect(merged.messages[0]?.renderKey).toBe('optimistic-user-1')
    expect(merged.messages.slice(1).map((message) => message.afterMessageId)).toEqual([
      'm-real-band',
      'm-real-band',
    ])
  })

  test('an OLDER user turn with the same text cannot swallow a fresh placeholder', () => {
    // Only rows NEW to the body count as the echo — a same-content row that was
    // already in prev is history, not the persisted send.
    const prev = sess({
      isRunning: true,
      messages: [
        msg({ id: 'm-past', role: 'user', content: 'hi' }),
        msg({ id: 'optimistic-user-1', role: 'user', content: 'hi', optimistic: true }),
      ],
    } as never)
    const next = sess({
      isRunning: true,
      messages: [msg({ id: 'm-past', role: 'user', content: 'hi' })],
    } as never)
    const merged = mergeSessionBody(prev, next)
    expect(merged.messages.map((m) => m.id)).toEqual(['m-past', 'optimistic-user-1'])
  })

  test('keeps streamingMessageId/activePhase while running on EITHER side', () => {
    // The optimistic isRunning lead means prev can be running before the body
    // says so; the converters never map these SSE-only fields, so next always
    // arrives without them.
    const phase = { id: 'thinking', label: 'Thinking' }
    const prev = sess({
      isRunning: true,
      streamingMessageId: 'm-live',
      activePhase: phase,
    } as never)
    const next = sess({ isRunning: false })
    const merged = mergeSessionBody(prev, next)
    expect(merged.streamingMessageId).toBe('m-live')
    expect(merged.activePhase).toEqual(phase)
  })

  test('a DETAIL that reports no live wait clears a stale terminal-wait phase', () => {
    // `terminal.waiting {active:false}` is live-only: a settle emitted while the socket was down
    // never replays, and the detail (`activePhase: null` from `terminalWaits`) was out-voted by
    // the stored phase, so the status line said "Waiting for background terminal" for the rest
    // of the run.
    const wait = { id: 'terminal-wait:t1', label: 'Waiting for background terminal' }
    const prev = sess({ isRunning: true, activePhase: wait } as never)
    const detail = sess({ isRunning: true, bodyLoaded: true, activePhase: null } as never)
    expect(mergeSessionBody(prev, detail).activePhase ?? null).toBeNull()
    // The detail's own wait still wins, and a non-wait phase is still carried (the converters
    // never map those).
    const live = { id: 'terminal-wait:t2', label: 'Waiting' }
    expect(
      mergeSessionBody(
        prev,
        sess({ isRunning: true, bodyLoaded: true, activePhase: live } as never),
      ).activePhase,
    ).toEqual(live)
    const thinking = { id: 'thinking', label: 'Thinking' }
    expect(
      mergeSessionBody(sess({ isRunning: true, activePhase: thinking } as never), detail)
        .activePhase,
    ).toEqual(thinking)
    // A body that is not a detail knows nothing about waits and cannot clear one.
    expect(mergeSessionBody(prev, sess({ isRunning: true })).activePhase).toEqual(wait)
  })

  test('does NOT keep the stream target once both sides are idle', () => {
    const prev = sess({ isRunning: false, streamingMessageId: 'm-stale' } as never)
    const next = sess({ isRunning: false })
    const merged = mergeSessionBody(prev, next)
    expect(merged.streamingMessageId ?? null).toBeNull()
  })

  /**
   * The sidebar's second line. Selecting a chat used to delete its own last message from the
   * list: the DETAIL body carries no preview (the transcript is right there), so the replace
   * blanked it — and every later summary omits it too while a run is live, so nothing put it
   * back until a reload.
   */
  const preview = { text: 'Backend restarted while bash…', from: 'assistant' } as never

  test('opening a session keeps the preview the list was showing', () => {
    const prev = sess({ lastMessage: preview })
    const detail = sess({ bodyLoaded: true, messages: [msg({ id: 'm1', role: 'user' })] })
    expect(mergeSessionBody(prev, detail).lastMessage).toEqual(preview)
  })

  test('a summary that HAS a newer preview still wins', () => {
    const fresher = { text: 'newer', from: 'user' } as never
    expect(
      mergeSessionBody(sess({ lastMessage: preview }), sess({ lastMessage: fresher })).lastMessage,
    ).toEqual(fresher)
    // …and on the summary-onto-loaded path, which returns a hand-built object.
    const merged = mergeSessionBody(
      sess({ bodyLoaded: true, lastMessage: preview }),
      sess({ bodyLoaded: false, lastMessage: fresher }),
    )
    expect(merged.lastMessage).toEqual(fresher)
  })

  test('a summary with no preview does not blank a loaded one', () => {
    const merged = mergeSessionBody(
      sess({ bodyLoaded: true, lastMessage: preview }),
      sess({ bodyLoaded: false }),
    )
    expect(merged.lastMessage).toEqual(preview)
  })
})
