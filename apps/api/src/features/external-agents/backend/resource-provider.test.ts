import { describe, expect, test } from 'bun:test'

import {
  createExternalAgentResourceProvider,
  type ExternalAgentResourceService,
} from './resource-provider'
import { linkKeyOf } from '../shared/identity'
import type {
  ProviderStatus,
  RosterRow,
  TranscriptEvent,
  TranscriptSlice,
} from '../shared/contracts'

const NOW = Date.parse('2026-08-02T12:00:00.000Z')
const HOUR_MS = 3_600_000
const PROJECT = '/Users/dev/checkout'
/** The budget `expand-refs` gives kind `resource`; a digest that overruns it is not a digest. */
const RESOURCE_BUDGET_CHARS = 3_000

function row(partial: Partial<RosterRow> & Pick<RosterRow, 'nativeSessionId'>): RosterRow {
  const provider = partial.provider ?? 'claude-code'
  return {
    key: linkKeyOf({ provider, nativeSessionId: partial.nativeSessionId }),
    provider,
    title: `session ${partial.nativeSessionId}`,
    cwd: PROJECT,
    updatedAt: NOW - HOUR_MS,
    messageCount: 12,
    sourcePath: `/Users/dev/.claude/${partial.nativeSessionId}.jsonl`,
    state: 'idle',
    authority: 'none',
    ...partial,
  }
}

function status(
  partial: Partial<ProviderStatus> & Pick<ProviderStatus, 'provider'>,
): ProviderStatus {
  return {
    displayName: partial.provider,
    roots: [],
    sessionCount: 1,
    verified: true,
    ...partial,
  }
}

function event(index: number, text: string): TranscriptEvent {
  return {
    provider: 'claude-code',
    nativeSessionId: 'abc',
    role: index % 2 === 0 ? 'user' : 'assistant',
    ordinal: index,
    text,
  }
}

function transcript(options: { read: number; total: number }): TranscriptSlice {
  // The digest asks for the TAIL, so what comes back is the session's last `read` events and their
  // ordinals are positions in the whole conversation — not indices into this slice. Modelling them
  // as 0..read-1 would make every assertion below agree with a digest that read the wrong end.
  const offset = Math.max(0, options.total - options.read)
  const events = Array.from({ length: options.read }, (_, index) =>
    event(offset + index, `turn ${offset + index} — ${'detail '.repeat(20)}`),
  )
  return {
    key: 'claude-code:abc',
    summary: {
      key: 'claude-code:abc',
      provider: 'claude-code',
      nativeSessionId: 'abc',
      title: 'Refactor the auth module',
      cwd: PROJECT,
      startedAt: NOW - 4 * HOUR_MS,
      updatedAt: NOW - HOUR_MS,
      sourcePath: '/Users/dev/.claude/abc.jsonl',
    },
    events,
    withheld: options.total - options.read,
    total: options.total,
  }
}

function service(
  options: {
    rows?: readonly RosterRow[]
    statuses?: readonly ProviderStatus[]
    slice?: TranscriptSlice | null
  } = {},
): ExternalAgentResourceService {
  const rows = options.rows ?? []
  return {
    async providers() {
      return options.statuses ?? []
    },
    // Mirrors discovery/roster.ts: filter by provider, then by text, and only then bound. The
    // provider under test relies on that order, so a fake that bounded first would agree with a
    // bug instead of catching it.
    async roster(query) {
      let matched = rows
      if (query.providers?.length) {
        const allowed = new Set(query.providers)
        matched = matched.filter((candidate) => allowed.has(candidate.provider))
      }
      const text = query.text?.trim().toLocaleLowerCase()
      if (text) {
        matched = matched.filter((candidate) =>
          `${candidate.title}\n${candidate.cwd ?? ''}\n${candidate.nativeSessionId}\n${candidate.provider}`
            .toLocaleLowerCase()
            .includes(text),
        )
      }
      const items = matched.slice(0, query.limit ?? 200)
      return { items, total: matched.length, withheld: matched.length - items.length }
    },
    async transcript() {
      return options.slice ?? null
    },
  }
}

const provider = (options: Parameters<typeof service>[0] = {}) =>
  createExternalAgentResourceProvider(service(options), () => NOW)

describe('external agent resource provider', () => {
  test('the roots are the provider adapters that have history on this machine', async () => {
    const nodes = await provider({
      statuses: [
        status({ provider: 'claude-code', displayName: 'Claude Code', sessionCount: 409 }),
        status({ provider: 'codex', displayName: 'Codex', sessionCount: 0 }),
        status({
          provider: 'gemini-cli',
          displayName: 'Gemini CLI',
          sessionCount: 3,
          verified: false,
        }),
      ],
    }).listChildren('user', null)

    expect(nodes).toEqual([
      {
        uri: 'localix://resource/external-agent/claude-code',
        label: 'Claude Code',
        detail: '409 sessions',
        hasChildren: true,
        navigationOnly: true,
        icon: 'claude-code',
      },
      {
        uri: 'localix://resource/external-agent/gemini-cli',
        label: 'Gemini CLI',
        detail: '3 sessions · unverified adapter',
        hasChildren: true,
        navigationOnly: true,
        icon: 'gemini-cli',
      },
    ])
  })

  test('a provider whose history is empty here says so instead of listing nothing', async () => {
    expect(await provider({ statuses: [] }).listChildren('user', null)).toEqual([
      expect.objectContaining({
        uri: 'localix://resource/external-agent#notice',
        label: 'No external agent history on this machine',
        notice: true,
      }),
    ])

    expect(
      await provider({ statuses: [status({ provider: 'codex' })] }).listChildren(
        'user',
        'localix://resource/external-agent/codex',
      ),
    ).toEqual([
      expect.objectContaining({
        uri: 'localix://resource/external-agent/codex#notice',
        label: 'No Codex sessions on this machine',
        notice: true,
      }),
    ])
  })

  test('a failed provider scan is reported as a notice, not as an absent history', async () => {
    const nodes = await provider({
      statuses: [status({ provider: 'codex', sessionCount: 0, error: 'EACCES ~/.codex' })],
    }).listChildren('user', null)

    expect(nodes).toContainEqual(
      expect.objectContaining({
        label: 'codex history could not be read',
        detail: 'EACCES ~/.codex',
        notice: true,
      }),
    )
  })

  test('a provider that records a cwd drills through projects to its sessions', async () => {
    const tree = provider({
      rows: [
        row({ nativeSessionId: 'one' }),
        row({ nativeSessionId: 'two' }),
        row({ nativeSessionId: 'three', cwd: '/Users/dev/other' }),
      ],
    })

    expect(
      await tree.listChildren('user', 'localix://resource/external-agent/claude-code'),
    ).toEqual([
      {
        uri: `localix://resource/external-agent/claude-code/cwd/${encodeURIComponent(PROJECT)}`,
        label: 'checkout',
        detail: `2 sessions · 1h ago · ${PROJECT}`,
        hasChildren: true,
        navigationOnly: true,
        icon: 'folder',
      },
      {
        uri: 'localix://resource/external-agent/claude-code/cwd/%2FUsers%2Fdev%2Fother',
        label: 'other',
        detail: `1 session · 1h ago · /Users/dev/other`,
        hasChildren: true,
        navigationOnly: true,
        icon: 'folder',
      },
    ])

    expect(
      await tree.listChildren(
        'user',
        `localix://resource/external-agent/claude-code/cwd/${encodeURIComponent(PROJECT)}`,
      ),
    ).toEqual([
      {
        uri: 'localix://resource/external-agent/claude-code/one',
        label: 'session one',
        detail: '1h ago · 12 events',
        hasChildren: false,
        icon: 'claude-code',
        actions: [{ id: 'link', label: 'Link this session', kind: 'link' }],
      },
      expect.objectContaining({ uri: 'localix://resource/external-agent/claude-code/two' }),
    ])

    expect(
      await tree.listChildren('user', 'localix://resource/external-agent/claude-code/one'),
    ).toEqual([])
  })

  test('a provider that records no cwd lists its sessions without an empty project level', async () => {
    const nodes = await provider({
      rows: [row({ provider: 'gemini-cli', nativeSessionId: 'g1', cwd: undefined })],
    }).listChildren('user', 'localix://resource/external-agent/gemini-cli')

    expect(nodes).toEqual([
      expect.objectContaining({
        uri: 'localix://resource/external-agent/gemini-cli/g1',
        hasChildren: false,
      }),
    ])
  })

  test('a session the cap dropped is still reachable by typing', async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      row({
        nativeSessionId: `s${index}`,
        title: index === 57 ? 'the needle' : `haystack ${index}`,
      }),
    )
    const tree = provider({ rows })
    const projectUri = `localix://resource/external-agent/claude-code/cwd/${encodeURIComponent(PROJECT)}`

    const unfiltered = await tree.listChildren('user', projectUri)
    expect(unfiltered).toHaveLength(51)
    expect(unfiltered.filter((node) => node.notice !== true)).toHaveLength(50)
    expect(unfiltered.at(-1)).toEqual(
      expect.objectContaining({
        uri: `${projectUri}#notice`,
        label: 'Showing 50 of 60 sessions',
        notice: true,
      }),
    )
    expect(unfiltered.some((node) => node.label === 'the needle')).toBe(false)

    expect(await tree.listChildren('user', projectUri, 'needle')).toEqual([
      expect.objectContaining({ label: 'the needle' }),
    ])
  })

  test('an over-cap project level pages the projects and says how many it dropped', async () => {
    const nodes = await provider({
      rows: Array.from({ length: 55 }, (_, index) =>
        row({ nativeSessionId: `s${index}`, cwd: `/Users/dev/p${index}` }),
      ),
    }).listChildren('user', 'localix://resource/external-agent/claude-code')

    expect(nodes).toHaveLength(51)
    expect(nodes.at(-1)).toEqual(
      expect.objectContaining({
        label: 'Showing 50 of 55 projects',
        detail: 'type to search the full list',
        notice: true,
      }),
    )
  })

  test('a live delegation that has not correlated yet is not offered as a ref', async () => {
    const pending = row({ nativeSessionId: 'pending-terminal-t7', title: 'claude delegation' })
    const nodes = await provider({ rows: [pending] }).listChildren(
      'user',
      'localix://resource/external-agent/claude-code',
    )

    expect(nodes).toEqual([expect.objectContaining({ notice: true })])
  })

  test('a URI owned by another provider is refused rather than answered', async () => {
    const tree = provider({ rows: [row({ nativeSessionId: 'one' })] })

    expect(
      await tree.listChildren('user', 'localix://resource/other-resource/conn/_/public'),
    ).toEqual([])
    expect(await tree.listChildren('user', 'not-a-uri')).toEqual([])
    expect(await tree.expand('user', 'localix://resource/other-resource/conn')).toEqual({
      ok: false,
      error: 'not an external agent resource',
    })
  })

  test('expanding a session that is no longer on disk says what to do instead', async () => {
    expect(
      await provider({ slice: null }).expand(
        'user',
        'localix://resource/external-agent/claude-code/gone',
      ),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('no transcript on disk for "claude-code:gone"'),
    })

    expect(await provider().expand('user', 'localix://resource/external-agent/aider/x')).toEqual({
      ok: false,
      error: expect.stringContaining('unknown agent provider "aider"'),
    })

    expect(
      await provider().expand('user', 'localix://resource/external-agent/claude-code'),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('group of Claude Code sessions'),
    })
  })

  test('an expanded session is a bounded digest that ends by naming the tool to read more', async () => {
    const expansion = await provider({ slice: transcript({ read: 30, total: 30 }) }).expand(
      'user',
      'localix://resource/external-agent/claude-code/abc',
    )

    expect(expansion.ok).toBe(true)
    const content = expansion.content ?? ''
    expect(content.length).toBeLessThanOrEqual(RESOURCE_BUDGET_CHARS)
    expect(content).toStartWith('## claude-code — Refactor the auth module\nkey: claude-code:abc\n')
    expect(content).toContain(`cwd: ${PROJECT}    source: /Users/dev/.claude/abc.jsonl`)
    expect(content).toContain(
      'range: 2026-08-02T08:00:00.000Z → 2026-08-02T11:00:00.000Z    events: 30',
    )
    expect(content).toContain("turns 25–30 of 30 — the session's most recent; the 24 earlier")
    expect(content).toEndWith(
      '(Compact digest of an external claude-code session. Full transcript: external_agent_sessions { action: "transcript", key: "claude-code:abc" }. Several sessions at once: { action: "context", keys: [...] }. Live state: { action: "explain", key: "claude-code:abc" }.)',
    )
    expect(content).toContain('action: "resume", key: "claude-code:abc"')
    expect(content).toContain('then execute the returned command with bash action:"open"')
    expect(content).toContain('Reading its transcript does not open a terminal.')
    // The tail, never the whole transcript: 30 turns were read, 6 at most are shown.
    expect(content.match(/^\[(user|assistant)] /gm)).toHaveLength(6)
  })

  test('a session longer than the scan window still ends where the session does', async () => {
    // The digest used to read from the HEAD, so a session past the scan window showed its middle
    // while looking like its end — the one shape a reader cannot detect. The range is now read
    // from each event's own ordinal, so the last turn shown IS the last turn there is.
    const expansion = await provider({ slice: transcript({ read: 1_000, total: 5_210 }) }).expand(
      'user',
      'localix://resource/external-agent/claude-code/abc',
    )
    const content = expansion.content ?? ''

    expect(content).toContain('events: 5210')
    expect(content).toContain('turns 5205–5210 of 5210')
    // What it omits is said in words, and is the half that IS reachable: `transcript` reads from
    // the start, which the footer already names.
    expect(content).toContain('5204 earlier turns are not shown')
    expect(content.length).toBeLessThanOrEqual(RESOURCE_BUDGET_CHARS)
  })

  test('a shown result is named by a call that was read but not shown', async () => {
    /**
     * A result carries the call's ID and not its name — that is the adapters' convention, because
     * the id is what pairing is decided on. The digest prints six turns out of a thousand-event
     * window, so the call naming a shown result is almost always read and almost never shown, and
     * the line came out as a bare `[tool]`: output with nothing saying what ran. On long sessions
     * that is a common way for a digest to open.
     */
    const base = transcript({ read: 30, total: 30 })
    const events = [...base.events]
    events[0] = { ...events[0]!, role: 'assistant', toolName: 'Bash', toolCallId: 'call-1' }
    // Last turn, so it IS shown; the call above is not.
    events[29] = { ...events[29]!, role: 'tool', toolCallId: 'call-1', text: '4 files changed' }

    const expansion = await provider({ slice: { ...base, events } }).expand(
      'user',
      'localix://resource/external-agent/claude-code/abc',
    )
    const content = expansion.content ?? ''

    expect(content).toContain('[tool:Bash] 4 files changed')
    expect(content).not.toContain('[tool] 4 files changed')
  })

  test('a name is looked up, never invented', async () => {
    // No call for this id anywhere in the window, so there is nothing to name it with and the line
    // must stay honest rather than borrow the nearest tool's name.
    const base = transcript({ read: 30, total: 30 })
    const events = [...base.events]
    events[29] = { ...events[29]!, role: 'tool', toolCallId: 'orphan', text: 'exit 0' }

    const expansion = await provider({ slice: { ...base, events } }).expand(
      'user',
      'localix://resource/external-agent/claude-code/abc',
    )
    expect(expansion.content ?? '').toContain('[tool] exit 0')
  })

  test('the digest asks its transcript for the tail, not the opening', async () => {
    // The whole fix rests on this argument: without it the events handed back are the session's
    // first N and every range line above is describing the wrong end of the conversation.
    const asked: { tail?: boolean; maxEvents?: number } = {}
    const service = {
      providers: async () => [],
      roster: async () => ({ items: [], withheld: 0, total: 0 }),
      transcript: async (_key: string, maxEvents?: number, _chars?: number, tail?: boolean) => {
        asked.tail = tail
        asked.maxEvents = maxEvents
        return transcript({ read: 30, total: 30 })
      },
    }
    await createExternalAgentResourceProvider(service, () => NOW).expand(
      'user',
      'localix://resource/external-agent/claude-code/abc',
    )
    expect(asked.tail).toBe(true)
    expect(asked.maxEvents).toBeGreaterThan(0)
  })

  test('a transcript with no readable turns still expands to its provenance', async () => {
    const empty = transcript({ read: 0, total: 0 })
    const expansion = await provider({
      // Nothing dates this session — neither a recorded start nor a timestamped event.
      slice: { ...empty, summary: { ...empty.summary, startedAt: undefined } },
    }).expand('user', 'localix://resource/external-agent/claude-code/abc')

    expect(expansion.ok).toBe(true)
    expect(expansion.content).toContain('range: (start unknown) → 2026-08-02T11:00:00.000Z')
    expect(expansion.content).toContain('(No readable turns in this transcript.)')
  })
})

describe('the digest tells the truth about how far one read gets', () => {
  /**
   * The footer said "Full transcript: external_agent_sessions { action: transcript … }" for every
   * session. One read returns at most `MAX_TRANSCRIPT_EVENTS`, so on a session of several thousand
   * events that pointer promised all of them and delivers 2,000. The same overclaim was corrected
   * in the transcript answer and the import note; this is the third surface, and the one a person
   * uses most, since it is what an `@`-inserted chip expands into.
   */
  const uri = 'localix://resource/external-agent/claude-code/abc'

  test('a session that fits in one read still says "full"', async () => {
    const out = await provider({ slice: transcript({ read: 6, total: 40 }) }).expand('user', uri)

    expect(out.ok).toBe(true)
    expect(out.ok && out.content).toContain('Full transcript')
    expect(out.ok && out.content).not.toContain('more than one read')
  })

  test('a session past the cap names the walk instead of promising the whole thing', async () => {
    const out = await provider({ slice: transcript({ read: 6, total: 8_753 }) }).expand('user', uri)

    expect(out.ok).toBe(true)
    const content = out.ok ? out.content : ''
    expect(content).not.toContain('Full transcript')
    expect(content).toContain('8753 events — more than one read returns')
    // The way in, and the way to the end, both named.
    expect(content).toContain('from: 0')
    expect(content).toContain('tail: true')
  })
})
