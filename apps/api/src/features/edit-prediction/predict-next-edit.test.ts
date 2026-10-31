import { describe, expect, it } from 'bun:test'
import type { LanguageModelRequest } from '@localixai/agent/runtime'
import { MAX_EDITS, PROMPT_WINDOW_BYTE_CEILING, PROMPT_WINDOW_LINES } from './contracts'
import { createEditPredictionEngine, type NextEditService } from './engine'
import { parseNextEditReplyDetailed } from './parse'

const parseNextEditReply = (raw: string, fileContent: string) =>
  parseNextEditReplyDetailed(raw, fileContent).edits

/** The edits of a prediction, without the reason an empty one carries. */
const predictEdits = (
  service: NextEditService,
  ...args: Parameters<NextEditService['predictDetailed']>
) => service.predictDetailed(...args).then((result) => result.edits)
import { buildEditPredictionPrompt as buildPrompt, numberFileForPrompt } from './prompt/build'
import { nextEditReplySchema } from './validate'

const FILE = ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4'].join('\n')
const CORRELATION = { requestId: 'req-1', documentVersion: 1, documentDigest: 'digest-1' }

describe('parseNextEditReply (same-file)', () => {
  it('parses a canonical strict-JSON edit envelope', () => {
    const raw = '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}'
    expect(parseNextEditReply(raw, FILE)).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
  })

  // Marking the caret in the text hands the model a token it can copy into its answer, and a
  // replacement carrying `<|cursor|>` or an echoed `N\t` prefix corrupts the file silently —
  // it is a well-formed hunk by every other check. Stripping is the guarantee; the count is
  // how we learn it is happening.
  describe('prompt scaffolding echoed back into a replacement', () => {
    it('strips the cursor marker and reports the echo', () => {
      const raw = '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b<|cursor|> = 20"}]}'
      const { edits, scaffoldEchoes } = parseNextEditReplyDetailed(raw, FILE)
      expect(edits).toEqual([
        { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
      ])
      expect(scaffoldEchoes).toBe(1)
    })

    it('strips echoed line numbers when every prefix matches its real line', () => {
      const raw =
        '{"edits":[{"startLine":2,"endLine":3,"replacement":"2\\tconst b = 20\\n3\\tconst c = 30"}]}'
      const { edits, scaffoldEchoes } = parseNextEditReplyDetailed(raw, FILE)
      expect(edits?.[0]?.replacement).toBe('const b = 20\nconst c = 30')
      expect(scaffoldEchoes).toBe(1)
    })

    it('leaves real content that merely looks numbered alone', () => {
      // A TSV-ish line whose leading number is NOT the line number it sits on.
      const raw = '{"edits":[{"startLine":2,"endLine":2,"replacement":"7\\tvalue"}]}'
      const { edits, scaffoldEchoes } = parseNextEditReplyDetailed(raw, FILE)
      expect(edits?.[0]?.replacement).toBe('7\tvalue')
      expect(scaffoldEchoes).toBe(0)
    })

    it('rejects a hunk that only echoed scaffolding as the no-op it is', () => {
      // Stripping must precede the no-op test, or `"2\tconst b = 2"` reads as a change.
      const raw = '{"edits":[{"startLine":2,"endLine":2,"replacement":"2\\tconst b = 2"}]}'
      const { edits, rejections } = parseNextEditReplyDetailed(raw, FILE)
      expect(edits).toBeNull()
      expect(rejections).toEqual({ no_op: 1 })
    })

    it('reports nothing when a reply is clean', () => {
      const raw = '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}'
      expect(parseNextEditReplyDetailed(raw, FILE).scaffoldEchoes).toBe(0)
    })
  })

  it('records only aggregated Context Fabric diagnostics in prediction telemetry', async () => {
    const outcomes: unknown[] = []
    const result = {
      contributions: [],
      dropped: [],
      bytes: 0,
      diagnostics: { droppedByReason: { secret: 1, excluded_uri: 2 } },
      providerOutcomes: [
        { providerId: 'private-provider', status: 'timeout' as const, contributionCount: 0 },
      ],
      referenceOutcomes: [],
    }
    const service = createEditPredictionEngine({
      contextManager: { collect: async () => result, resolveExplicit: async () => result } as never,
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () =>
        ({
          providerConnectionId: 'p',
          model: { complete: async () => ({ content: 'null' }) },
        }) as never,
      recordOutcome: (event) => outcomes.push(event),
    })
    await service.predictDetailed('u', {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/private/a.ts',
      content: FILE,
      cursorLine: 1,
      language: 'typescript',
      recentlyEditedRanges: [],
      contextReferences: [
        {
          kind: 'resource',
          token: '@resource:secret-reference',
          label: 'secret-reference',
          uri: 'localix://resource/fixture-db/credentials',
        },
      ],
    })
    expect(outcomes).toEqual([
      expect.objectContaining({
        context: {
          providerCount: 2,
          contributionCount: 0,
          droppedByReason: { secret: 2, excluded_uri: 4 },
          outcomesByStatus: { timeout: 2 },
        },
      }),
    ])
    const serialized = JSON.stringify(outcomes)
    expect(serialized).not.toContain('private-provider')
    expect(serialized).not.toContain('/private/a.ts')
    expect(serialized).not.toContain('localix://resource/fixture-db/credentials')
    expect(serialized).not.toContain('secret-reference')
  })

  it('injects only the server-resolved workspace into both Context Fabric paths', async () => {
    const requests: Array<{ workspace?: unknown }> = []
    const manager = {
      collect: async (request: { workspace?: unknown }) => {
        requests.push(request)
        return {
          contributions: [],
          dropped: [],
          diagnostics: { droppedByReason: {} },
          bytes: 0,
          providerOutcomes: [],
        }
      },
      resolveExplicit: async (request: { workspace?: unknown }) => {
        requests.push(request)
        return {
          contributions: [],
          dropped: [],
          diagnostics: { droppedByReason: {} },
          bytes: 0,
          providerOutcomes: [],
          referenceOutcomes: [],
        }
      },
    }
    const service = createEditPredictionEngine({
      contextManager: manager as never,
      resolveContextWorkspace: async () => ({
        rootPath: '/trusted/isolated',
        isolationId: 'iso-1',
      }),
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () =>
        ({
          providerConnectionId: 'p',
          model: { complete: async () => ({ content: 'null' }) },
        }) as never,
    })
    await service.predictDetailed('u', {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/untrusted/client-path.ts',
      content: FILE,
      cursorLine: 1,
      language: 'typescript',
      recentlyEditedRanges: [],
      contextReferences: [
        {
          kind: 'resource',
          token: '@resource:untrusted',
          label: 'untrusted',
          uri: 'localix://resource/fixture-db/untrusted',
        },
      ],
    })
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.workspace)).toEqual([
      { rootPath: '/trusted/isolated', isolationId: 'iso-1' },
      { rootPath: '/trusted/isolated', isolationId: 'iso-1' },
    ])
    expect(requests[0]).toEqual(
      expect.objectContaining({
        document: expect.objectContaining({ uri: '/untrusted/client-path.ts' }),
        workspace: { rootPath: '/trusted/isolated', isolationId: 'iso-1' },
      }),
    )
    // The request path remains model/document metadata; it never becomes the
    // filesystem admission root. Opaque references are resolved separately.
    expect((requests[0] as { workspace?: { rootPath?: string } }).workspace?.rootPath).not.toBe(
      '/untrusted/client-path.ts',
    )
  })

  it('parses a fenced JSON edit spanning multiple lines', () => {
    const raw = '```json\n{"edits":[{"startLine":2,"endLine":3,"replacement":"X\\nY"}]}\n```'
    expect(parseNextEditReply(raw, FILE)).toEqual([
      { startLine: 2, endLine: 3, original: 'const b = 2\nconst c = 3', replacement: 'X\nY' },
    ])
  })

  it('parses the {"edits":[…]} multi-hunk form, sorted by startLine', () => {
    const raw = JSON.stringify({
      edits: [
        { startLine: 3, endLine: 3, replacement: 'const c = 30' },
        { startLine: 1, endLine: 1, replacement: 'const a = 10' },
      ],
    })
    expect(parseNextEditReply(raw, FILE)?.map((e) => e.startLine)).toEqual([1, 3])
  })

  it('rejects a non-canonical bare top-level array', () => {
    const raw = '[{"startLine":1,"endLine":1,"replacement":"const a = 10"}]'
    expect(parseNextEditReply(raw, FILE)).toBeNull()
  })

  it('drops an invalid hunk but keeps the valid ones (fail-safe per hunk)', () => {
    const raw = JSON.stringify({
      edits: [
        { startLine: 'nope', endLine: 1, replacement: 'x' }, // wrong-typed → dropped
        { startLine: 2, endLine: 2, replacement: 'const b = 20' },
      ],
    })
    expect(parseNextEditReply(raw, FILE)).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
  })

  it('drops a hunk that overlaps an earlier-listed one (first wins)', () => {
    const raw = JSON.stringify({
      edits: [
        { startLine: 1, endLine: 2, replacement: 'A' },
        { startLine: 2, endLine: 3, replacement: 'B' }, // overlaps [1,2] → dropped
      ],
    })
    const edits = parseNextEditReply(raw, FILE)
    expect(edits).toHaveLength(1)
    expect(edits![0]).toMatchObject({ startLine: 1, endLine: 2, replacement: 'A' })
  })

  it(`caps the diff at MAX_EDITS (${MAX_EDITS}) hunks`, () => {
    const edits = Array.from({ length: MAX_EDITS + 3 }, (_, i) => ({
      startLine: i + 1,
      endLine: i + 1,
      replacement: `x${i}`,
    }))
    // Only lines 1..4 exist, so out-of-range ones drop anyway; assert the cap holds.
    const raw = JSON.stringify({ edits })
    expect((parseNextEditReply(raw, FILE) ?? []).length).toBeLessThanOrEqual(MAX_EDITS)
  })

  it('rejects alternate unified-diff response formats', () => {
    const raw = '```diff\n@@ -2,1 +2,1 @@\n-const b = 2\n+const b = 20\n```'
    expect(parseNextEditReply(raw, FILE)).toBeNull()
  })

  it('ignores an advisory `original` from the model (drift baseline re-sliced)', () => {
    const raw =
      '{"edits":[{"startLine":2,"endLine":2,"original":"garbage","replacement":"const b = 20"}]}'
    expect(parseNextEditReply(raw, FILE)).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
  })

  it('returns null for an explicit null reply', () => {
    expect(parseNextEditReply('null', FILE)).toBeNull()
  })

  it('returns null for a no-op edit (replacement equals original)', () => {
    expect(
      parseNextEditReply(
        '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 2"}]}',
        FILE,
      ),
    ).toBeNull()
  })

  it('returns null when the range is out of bounds', () => {
    expect(
      parseNextEditReply('{"edits":[{"startLine":99,"endLine":99,"replacement":"x"}]}', FILE),
    ).toBeNull()
  })

  it('returns null for malformed / non-JSON / non-edit replies', () => {
    expect(parseNextEditReply('', FILE)).toBeNull()
    expect(parseNextEditReply('sure, here you go', FILE)).toBeNull()
    expect(parseNextEditReply('{not json', FILE)).toBeNull()
  })
})

describe('nextEditReplySchema', () => {
  it('accepts a well-formed reply (original optional)', () => {
    expect(
      nextEditReplySchema.safeParse({ startLine: 1, endLine: 2, replacement: 'x' }).success,
    ).toBe(true)
    expect(
      nextEditReplySchema.safeParse({ startLine: 1, endLine: 2, original: 'o', replacement: 'x' })
        .success,
    ).toBe(true)
  })

  it('rejects bad shapes', () => {
    expect(
      nextEditReplySchema.safeParse({ startLine: '1', endLine: 2, replacement: 'x' }).success,
    ).toBe(false)
    expect(
      nextEditReplySchema.safeParse({ startLine: 3, endLine: 2, replacement: 'x' }).success,
    ).toBe(false)
    expect(nextEditReplySchema.safeParse({ startLine: 1, endLine: 2 }).success).toBe(false)
    expect(
      nextEditReplySchema.safeParse({ startLine: 0, endLine: 1, replacement: 'x' }).success,
    ).toBe(false)
  })
})

describe('numberFileForPrompt (large-file windowing)', () => {
  it('shows the whole file when small, with 1-based numbers', () => {
    const out = numberFileForPrompt(FILE, 1)
    expect(out).toBe('1\tconst a = 1\n2\tconst b = 2\n3\tconst c = 3\n4\tconst d = 4')
  })

  // Marking the caret IN the text avoids making the model count columns from prose coordinates
  // placed ahead of a long numbered file. The rejection tally measures the resulting
  // `out_of_range` and `no_op` location errors.
  it('marks the caret inside the cursor line at the given column', () => {
    expect(numberFileForPrompt(FILE, 2, 5)).toBe(
      '1\tconst a = 1\n2\tconst<|cursor|> b = 2\n3\tconst c = 3\n4\tconst d = 4',
    )
  })

  it('leaves the file untouched when the column is unknown', () => {
    // Marking the line's end would assert a caret position the request never supplied.
    expect(numberFileForPrompt(FILE, 2)).toBe(
      '1\tconst a = 1\n2\tconst b = 2\n3\tconst c = 3\n4\tconst d = 4',
    )
  })

  it('clamps a column past the end of the line instead of throwing', () => {
    expect(numberFileForPrompt(FILE, 1, 999)).toContain('1\tconst a = 1<|cursor|>')
  })

  it('marks the caret in a windowed large file too', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n')
    expect(numberFileForPrompt(big, 1500, 4)).toContain('1500\tline<|cursor|> 1499')
  })

  // A line budget says nothing about SIZE, and size is what a prediction pays for in prefill on
  // every keystroke. Measured before the ceiling existed: 1200 lines of ordinary code render
  // ~54 KiB, but 1200 lines of a 12-field object literal — generated code, i18n tables, JSX with
  // long class strings — rendered 358 KiB (~90k tokens), and line-windowing did not help at all
  // (20k such lines still rendered 382 KiB). The driver's 500 KB gate measures the DOCUMENT, so it
  // never caught it.
  describe('byte ceiling on the numbered window', () => {
    const wide = (i: number) =>
      `const row${i} = { ${Array.from({ length: 12 }, (_, k) => `f${k}: 'v-${i}-${k}'`).join(', ')} }`
    const wideFile = (n: number) => Array.from({ length: n }, (_, i) => wide(i)).join('\n')

    it('clamps a wide-line file to the ceiling', () => {
      const out = numberFileForPrompt(wideFile(1200), 600, 4)
      expect(out.length).toBeLessThanOrEqual(PROMPT_WINDOW_BYTE_CEILING)
    })

    it('still clamps when the file is far larger than the line window', () => {
      const out = numberFileForPrompt(wideFile(20_000), 10_000, 4)
      expect(out.length).toBeLessThanOrEqual(PROMPT_WINDOW_BYTE_CEILING)
    })

    it('leaves ordinary code at the full line window untouched', () => {
      // The point of the ceiling is to fix the tail, not to change the common case.
      const ordinary = Array.from({ length: PROMPT_WINDOW_LINES }, (_, i) => `const a${i} = ${i}`)
      const out = numberFileForPrompt(ordinary.join('\n'), 600, 4)
      expect(out.split('\n')).toHaveLength(PROMPT_WINDOW_LINES)
      expect(out).not.toContain('omitted')
    })

    it('keeps absolute line numbers and an honest elision marker after narrowing', () => {
      const out = numberFileForPrompt(wideFile(1200), 600, 4)
      // The cursor's own line is present, numbered with its real position…
      expect(out).toContain('600\t')
      // …and both open sides say how much was dropped.
      expect(out).toContain('earlier line')
      expect(out).toContain('later line')
    })

    it('shows the cursor line even when that one line exceeds the ceiling', () => {
      // One minified line can be larger than the whole budget. It is the line being edited, so
      // returning it over budget beats returning nothing the model can anchor to.
      const huge = 'x'.repeat(PROMPT_WINDOW_BYTE_CEILING * 2)
      const out = numberFileForPrompt(['a', huge, 'b'].join('\n'), 2, 0)
      expect(out).toContain('2\t')
      expect(out.length).toBeGreaterThan(PROMPT_WINDOW_BYTE_CEILING)
    })
  })

  it('windows a large file around the cursor keeping absolute line numbers', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n')
    const out = numberFileForPrompt(big, 1500)
    expect(out).toContain('1500\tline 1499')
    expect(out).toContain('omitted')
    expect(out).not.toContain('1\tline 0') // head elided
  })
})

describe('createEditPredictionEngine (same-file predict)', () => {
  function makeService() {
    let capturedUser = ''
    let capturedOpts: { cacheRetention?: string; reasoningEffort?: string } = {}
    const service = createEditPredictionEngine({
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: (async () => ({
        providerConnectionId: 'p',
        model: {
          complete: async (request: LanguageModelRequest) => {
            const content = request.messages[0]?.content
            capturedUser = typeof content === 'string' ? content : ''
            capturedOpts = request
            return {
              content: '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}',
              usage: undefined,
            }
          },
        },
      })) as never,
    })
    return { service, get: () => ({ capturedUser, capturedOpts }) }
  }

  it('predicts a same-file edit and threads edit history into the prompt', async () => {
    const { service, get } = makeService()
    const edits = await predictEdits(service, 'u', {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/proj/main.ts',
      content: FILE,
      cursorLine: 2,
      cursorColumn: 5,
      language: 'typescript',
      recentlyEditedRanges: [{ lines: ['const b = 2'], startLine: 2, endLine: 2 }],
    })
    const { capturedUser, capturedOpts } = get()
    expect(capturedUser).toContain('Current file path: /proj/main.ts')
    // The caret is MARKED in the text, not described as coordinates: the cursor line carries
    // the marker in situ and is repeated on its own so it survives a long file.
    expect(capturedUser).toContain('2\tconst<|cursor|> b = 2')
    expect(capturedUser).toContain('Cursor location:')
    expect(capturedUser).toContain('marked <|cursor|> in the file below')
    expect(capturedUser).toContain('Recent edits (oldest first')
    // No provider-side cache write: the static prefix is too small to be cacheable and
    // the volatile file window must never be written at the retention premium.
    expect(capturedOpts.cacheRetention).toBe('none')
    expect(capturedOpts.reasoningEffort).toBe('off')
    expect(edits).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
  })

  it('scopes "do not revert" to complete changes, so a deletion that left a hole still gets filled', () => {
    // Delete `Authorize,` from `private readonly authorize: Authorize,` and wait: the likeliest
    // completion resembles what was deleted. The bare anti-revert rule made the model answer
    // `null` there, so the prompt must say that completing unfinished code is the next edit.
    const { systemPrompt } = buildPrompt({
      sessionId: 's',
      ...CORRELATION,
      filepath: '/proj/main.ts',
      content: FILE,
      cursorLine: 2,
      language: 'typescript',
      recentlyEditedRanges: [],
    })
    expect(systemPrompt).toContain('Do NOT undo or revert')
    expect(systemPrompt).toContain('completing it IS the next edit')
  })

  it('renders host-owned history as events rather than generic supporting context', () => {
    const req = {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/proj/main.ts',
      content: FILE,
      cursorLine: 2,
      language: 'typescript',
      recentlyEditedRanges: [],
    }
    const { userContent } = buildPrompt(req, [
      {
        id: 'history',
        providerId: 'edit-prediction-host',
        providerVersion: '1',
        scope: 'session',
        kind: 'edit-history',
        content: '--- edit 1 (lines 2-2) ---\n+const b = 2',
        priority: 900,
        sensitivity: 'project',
      },
      {
        id: 'active',
        providerId: 'edit-prediction-host',
        providerVersion: '1',
        scope: 'document',
        kind: 'active-document',
        content: 'Active document: /proj/main.ts',
        priority: 1000,
        sensitivity: 'project',
      },
    ])
    expect(userContent).toContain('Recent edits (oldest first')
    expect(userContent).toContain('--- edit 1 (lines 2-2) ---')
    expect(userContent).not.toContain('Additional context (context only)')
  })

  it('keeps typed empty outcome available to v2 callers while predict stays ergonomic', async () => {
    const { service } = makeService()
    const request = {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/p/a.ts',
      content: FILE,
      cursorLine: 1,
      language: 'typescript',
      recentlyEditedRanges: [],
    }
    const detailed = await service.predictDetailed('u', request)
    expect(detailed).toMatchObject({ outcome: 'predicted', edits: [expect.any(Object)] })
    expect(await predictEdits(service, 'u', { ...request, content: '  ' })).toBeNull()
  })

  it('reports a metadata-only typed outcome for a provider failure', () => {
    const outcomes: unknown[] = []
    const service = createEditPredictionEngine({
      readAgentSettings: async () => ({
        modelRouting: { inlineCompletion: { enabled: true } },
      }),
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () =>
        ({
          model: {
            complete: async () => {
              throw new Error('network')
            },
          },
          providerConnectionId: 'p',
        }) as never,
      recordOutcome: (event) => outcomes.push(event),
    })
    expect(
      predictEdits(service, 'u', {
        sessionId: 's',
        ...CORRELATION,
        filepath: '/p/a.ts',
        content: FILE,
        cursorLine: 1,
        language: 'typescript',
        recentlyEditedRanges: [],
        contextReferences: [
          { kind: 'resource', token: '@resource:r', label: 'r', uri: 'opaque://r' },
        ],
      }),
    ).resolves.toBeNull()
    expect(outcomes).toEqual([
      expect.objectContaining({
        userId: 'u',
        sessionId: 's',
        outcome: 'provider_error',
        contextReferenceCount: 1,
        editCount: 0,
      }),
    ])
    expect(JSON.stringify(outcomes)).not.toContain(FILE)
    expect(JSON.stringify(outcomes)).not.toContain('opaque://r')
  })

  it('aborts the provider at the host deadline and reports no content in telemetry', async () => {
    let providerSignal: AbortSignal | undefined
    const outcomes: unknown[] = []
    const service = createEditPredictionEngine({
      deadlineMs: 10,
      readAgentSettings: async () => ({
        modelRouting: { inlineCompletion: { enabled: true } },
      }),
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () =>
        ({
          providerConnectionId: 'p',
          model: {
            complete: async (request: LanguageModelRequest) => {
              providerSignal = request.signal
              await new Promise<void>((resolve) =>
                request.signal?.addEventListener('abort', () => resolve(), { once: true }),
              )
              throw new DOMException('aborted', 'AbortError')
            },
          },
        }) as never,
      recordOutcome: (event) => outcomes.push(event),
    })
    const result = await service.predictDetailed('u', {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/private/source.ts',
      content: FILE,
      cursorLine: 1,
      language: 'typescript',
      recentlyEditedRanges: [],
    })
    expect(result).toEqual({ outcome: 'deadline_exceeded', edits: null })
    expect(providerSignal?.aborted).toBe(true)
    expect(JSON.stringify(outcomes)).not.toContain('/private/source.ts')
    expect(JSON.stringify(outcomes)).not.toContain(FILE)
  })

  it('keeps caller cancellation distinct from the host deadline', async () => {
    let providerSignal: AbortSignal | undefined
    const service = createEditPredictionEngine({
      deadlineMs: 1_000,
      readAgentSettings: async () => ({
        modelRouting: { inlineCompletion: { enabled: true } },
      }),
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: async () =>
        ({
          providerConnectionId: 'p',
          model: {
            complete: async (request: LanguageModelRequest) => {
              providerSignal = request.signal
              await new Promise<void>((resolve) =>
                request.signal?.addEventListener('abort', () => resolve(), { once: true }),
              )
              throw new DOMException('aborted', 'AbortError')
            },
          },
        }) as never,
    })
    const controller = new AbortController()
    const pending = service.predictDetailed(
      'u',
      {
        sessionId: 's',
        ...CORRELATION,
        filepath: '/p/a.ts',
        content: FILE,
        cursorLine: 1,
        language: 'typescript',
        recentlyEditedRanges: [],
      },
      controller.signal,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    expect(pending).resolves.toEqual({ outcome: 'cancelled', edits: null })
    expect(providerSignal?.aborted).toBe(true)
  })
})

describe('reversal guard, end to end through the engine', () => {
  function engineReturning(reply: string) {
    const outcomes: Array<{
      outcome: string
      editCount: number
      reversedEditCount?: number
    }> = []
    const service = createEditPredictionEngine({
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: (async () => ({
        providerConnectionId: 'p',
        model: { complete: async () => ({ content: reply, usage: undefined }) },
      })) as never,
      recordOutcome: (event) => outcomes.push(event as never),
    })
    return { service, outcomes }
  }

  const request = {
    sessionId: 's',
    ...CORRELATION,
    filepath: '/proj/main.ts',
    content: FILE,
    cursorLine: 2,
    cursorColumn: 5,
    language: 'typescript',
    // The user changed line 2 from `const b = 1` to `const b = 2`.
    recentlyEditedRanges: [
      { startLine: 2, endLine: 2, before: ['const b = 1'], lines: ['const b = 2'] },
    ],
  }

  it('suppresses a hunk that restores what the user just replaced, and counts it', async () => {
    const { service, outcomes } = engineReturning(
      '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 1"}]}',
    )
    const edits = await predictEdits(service, 'u', request)

    // Nothing offered: the only hunk was an undo of the user's own edit.
    expect(edits).toBeNull()
    expect(outcomes[0]).toMatchObject({ outcome: 'empty', editCount: 0, reversedEditCount: 1 })
  })

  it('leaves a forward hunk alone and reports nothing suppressed', async () => {
    const { service, outcomes } = engineReturning(
      '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}',
    )
    const edits = await predictEdits(service, 'u', request)

    expect(edits).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
    expect(outcomes[0]).toMatchObject({ outcome: 'predicted', editCount: 1, reversedEditCount: 0 })
  })
})

describe('parse rejections are tallied by cause', () => {
  it('separates mislocation from a malformed reply', () => {
    const raw = JSON.stringify({
      edits: [
        // Aims past the end of a 4-line file — the model knew what to write, not where.
        { startLine: 99, endLine: 99, replacement: 'const z = 0' },
        // Proposes exactly what is already there.
        { startLine: 2, endLine: 2, replacement: 'const b = 2' },
        // Malformed rather than mislocated.
        { startLine: 'nope', endLine: 1, replacement: 'x' },
      ],
    })
    const { edits, rejections } = parseNextEditReplyDetailed(raw, FILE)

    expect(edits).toBeNull()
    expect(rejections).toEqual({ out_of_range: 1, no_op: 1, schema: 1 })
  })

  it('reports nothing when every hunk survived', () => {
    const raw = '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 20"}]}'
    const { edits, rejections } = parseNextEditReplyDetailed(raw, FILE)
    expect(edits).toHaveLength(1)
    expect(rejections).toEqual({})
  })

  it('keeps the old entry point behaving identically', () => {
    const raw = JSON.stringify({
      edits: [
        { startLine: 99, endLine: 99, replacement: 'x' },
        { startLine: 2, endLine: 2, replacement: 'const b = 20' },
      ],
    })
    expect(parseNextEditReply(raw, FILE)).toEqual([
      { startLine: 2, endLine: 2, original: 'const b = 2', replacement: 'const b = 20' },
    ])
  })

  it('surfaces the tally on the prediction outcome', async () => {
    const outcomes: Array<{ editRejections?: Record<string, number> }> = []
    const service = createEditPredictionEngine({
      readAgentSettings: async () =>
        ({
          modelRouting: {
            inlineCompletion: { enabled: true, providerConnectionId: 'p', modelId: 'm' },
          },
        }) as never,
      getSessionModel: async () => ({ providerConnectionId: 'p', modelId: 'm' }),
      buildLanguageModel: (async () => ({
        providerConnectionId: 'p',
        model: {
          complete: async () => ({
            content: JSON.stringify({
              edits: [
                { startLine: 99, endLine: 99, replacement: 'x' },
                { startLine: 2, endLine: 2, replacement: 'const b = 20' },
              ],
            }),
            usage: undefined,
          }),
        },
      })) as never,
      recordOutcome: (event) => outcomes.push(event as never),
    })

    await predictEdits(service, 'u', {
      sessionId: 's',
      ...CORRELATION,
      filepath: '/proj/main.ts',
      content: FILE,
      cursorLine: 2,
      language: 'typescript',
      recentlyEditedRanges: [],
    })

    expect(outcomes[0]?.editRejections).toEqual({ out_of_range: 1 })
  })
})
