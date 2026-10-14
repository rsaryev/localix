import { describe, expect, test } from 'bun:test'
import { pathToFileURL } from 'node:url'
import {
  normalizeDocumentHighlights,
  normalizeInlayHints,
  normalizeDocumentColors,
  normalizeDocumentSymbols,
  normalizeSignatureHelp,
  normalizeWorkspaceEdit,
  normalizePrepareRename,
  normalizeTextEdits,
  normalizeCodeActions,
  normalizeRelatedInformation,
  normalizeDiagnostic,
  diagnosticsOverlappingRange,
} from './lsp-client'
import type { LspDiagnostic } from './lsp-client'

describe('normalizeTextEdits', () => {
  test('keeps valid edits, drops malformed ones', () => {
    const range = { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } }
    expect(normalizeTextEdits([{ range, newText: ' ' }])).toEqual([{ range, newText: ' ' }])
    // missing newText / bad range / non-array → filtered or empty
    expect(normalizeTextEdits([{ range }, { newText: 'x' }])).toEqual([])
    expect(normalizeTextEdits(null)).toEqual([])
    expect(normalizeTextEdits('nope')).toEqual([])
  })
})

describe('normalizeInlayHints', () => {
  const position = { line: 2, character: 6 }
  test('keeps string-label hints, maps known kinds + padding', () => {
    expect(
      normalizeInlayHints([{ position, label: ': string', kind: 1, paddingLeft: true }]),
    ).toEqual([
      { position, label: ': string', kind: 1, paddingLeft: true, paddingRight: undefined },
    ])
  })
  test('joins InlayHintLabelPart[] labels into one string', () => {
    const parts = [{ value: 'name' }, { value: ':' }]
    expect(normalizeInlayHints([{ position, label: parts, kind: 2 }])).toEqual([
      { position, label: 'name:', kind: 2, paddingLeft: undefined, paddingRight: undefined },
    ])
  })
  test('drops hints with no position, empty label, and unknown kinds', () => {
    expect(normalizeInlayHints([{ label: 'x' }])).toEqual([])
    expect(normalizeInlayHints([{ position, label: '   ' }])).toEqual([])
    expect(normalizeInlayHints([{ position, label: 'y', kind: 9 }])).toEqual([
      { position, label: 'y', kind: undefined, paddingLeft: undefined, paddingRight: undefined },
    ])
    expect(normalizeInlayHints(null)).toEqual([])
  })
})

describe('normalizeDocumentColors', () => {
  const range = { start: { line: 3, character: 2 }, end: { line: 3, character: 9 } }
  test('keeps valid colors and clamps channels to 0..1', () => {
    expect(
      normalizeDocumentColors([{ range, color: { red: 1, green: 0.5, blue: 0, alpha: 1 } }]),
    ).toEqual([{ range, color: { red: 1, green: 0.5, blue: 0, alpha: 1 } }])
    // out-of-range channels are clamped, not dropped
    expect(
      normalizeDocumentColors([{ range, color: { red: 2, green: -1, blue: 0.25, alpha: 3 } }]),
    ).toEqual([{ range, color: { red: 1, green: 0, blue: 0.25, alpha: 1 } }])
  })
  test('drops entries with no range, no color, or non-numeric channels', () => {
    expect(normalizeDocumentColors([{ color: { red: 0, green: 0, blue: 0, alpha: 1 } }])).toEqual(
      [],
    )
    expect(normalizeDocumentColors([{ range }])).toEqual([])
    expect(
      normalizeDocumentColors([{ range, color: { red: 'x', green: 0, blue: 0, alpha: 1 } }]),
    ).toEqual([])
    expect(normalizeDocumentColors(null)).toEqual([])
  })
})

describe('normalizeRelatedInformation', () => {
  const range = { start: { line: 3, character: 2 }, end: { line: 3, character: 9 } }
  const uri = pathToFileURL('/proj/other.ts').href
  test('converts uri → file path, keeps valid entries', () => {
    expect(
      normalizeRelatedInformation([{ location: { uri, range }, message: 'first defined here' }]),
    ).toEqual([{ location: { file: '/proj/other.ts', range }, message: 'first defined here' }])
  })
  test('drops entries with non-file uri, missing range, or non-string message', () => {
    expect(
      normalizeRelatedInformation([
        { location: { uri: 'untitled:foo', range }, message: 'nope' },
        { location: { uri, range: null }, message: 'nope' },
        { location: { uri, range }, message: 42 },
      ]),
    ).toBeUndefined()
  })
  test('returns undefined for non-array / empty', () => {
    expect(normalizeRelatedInformation(null)).toBeUndefined()
    expect(normalizeRelatedInformation([])).toBeUndefined()
  })
  test('normalizeDiagnostic attaches normalized related info, leaves plain diagnostics untouched', () => {
    const plain: LspDiagnostic = { range, message: 'x', severity: 1 }
    expect(normalizeDiagnostic(plain)).toBe(plain)
    const withRel = normalizeDiagnostic({
      range,
      message: 'dup',
      severity: 1,
      relatedInformation: [{ location: { uri, range }, message: 'here' }],
    } as unknown as LspDiagnostic)
    expect(withRel.relatedInformation).toEqual([
      { location: { file: '/proj/other.ts', range }, message: 'here' },
    ])
  })
  test('normalizeDiagnostic keeps the Unnecessary/Deprecated tags the editor draws, and only those', () => {
    // vtsls tags an unused declaration Unnecessary (1): the editor fades it. Losing the tag
    // is what left unused code looking exactly like used code.
    const unused = normalizeDiagnostic({
      range,
      message: "'x' is declared but its value is never read.",
      severity: 4,
      tags: [1, 7, 'x', 2],
    } as unknown as LspDiagnostic)
    expect(unused.tags).toEqual([1, 2])
    const junk = normalizeDiagnostic({ range, message: 'x', tags: [9] } as unknown as LspDiagnostic)
    expect('tags' in junk).toBe(false)
  })
})

describe('normalizeDocumentHighlights', () => {
  const range = { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } }
  test('keeps ranges, preserves valid kinds, drops malformed entries', () => {
    expect(
      normalizeDocumentHighlights([
        { range, kind: 2 },
        { range, kind: 3 },
        { range }, // kind omitted
      ]),
    ).toEqual([
      { range, kind: 2 },
      { range, kind: 3 },
      { range, kind: undefined },
    ])
  })
  test('drops entries with a malformed/missing range and coerces bad kinds to undefined', () => {
    expect(normalizeDocumentHighlights([{ kind: 2 }, { range: { start: { line: 0 } } }])).toEqual(
      [],
    )
    expect(normalizeDocumentHighlights([{ range, kind: 9 }])).toEqual([{ range, kind: undefined }])
  })
  test('non-array input → empty', () => {
    expect(normalizeDocumentHighlights(null)).toEqual([])
    expect(normalizeDocumentHighlights('nope')).toEqual([])
  })
})

describe('normalizeDocumentSymbols', () => {
  test('flattens hierarchical DocumentSymbol[] depth-first with depth + endLine', () => {
    const res = [
      {
        name: 'Foo',
        kind: 5,
        range: { start: { line: 2, character: 6 }, end: { line: 20 } },
        selectionRange: { start: { line: 2, character: 6 } },
        children: [
          {
            name: 'bar',
            kind: 6,
            range: { start: { line: 4 }, end: { line: 9 } },
            selectionRange: { start: { line: 4, character: 2 } },
          },
        ],
      },
    ]
    expect(normalizeDocumentSymbols(res)).toEqual([
      { name: 'Foo', kind: 5, line: 2, character: 6, endLine: 20, detail: undefined, depth: 0 },
      { name: 'bar', kind: 6, line: 4, character: 2, endLine: 9, detail: undefined, depth: 1 },
    ])
  })

  test('handles flat SymbolInformation[] (location.range) at depth 0', () => {
    const res = [
      {
        name: 'thing',
        kind: 13,
        location: { range: { start: { line: 0, character: 4 }, end: { line: 0 } } },
      },
    ]
    expect(normalizeDocumentSymbols(res)).toEqual([
      { name: 'thing', kind: 13, line: 0, character: 4, endLine: 0, detail: undefined, depth: 0 },
    ])
  })

  test('endLine never precedes line; line 0 is respected (not skipped)', () => {
    const res = [
      {
        name: 'top',
        kind: 12,
        range: { start: { line: 0 }, end: { line: 5 } },
        selectionRange: { start: { line: 0 } },
      },
    ]
    const [s] = normalizeDocumentSymbols(res)
    expect(s.line).toBe(0)
    expect(s.endLine).toBe(5)
  })

  test('drops nameless nodes; non-array → []', () => {
    expect(normalizeDocumentSymbols([{ kind: 5, range: { start: { line: 1 } } }])).toEqual([])
    expect(normalizeDocumentSymbols(null)).toEqual([])
    expect(normalizeDocumentSymbols({})).toEqual([])
  })
})

describe('normalizeSignatureHelp', () => {
  test('normalizes signatures, string + [start,end]-tuple parameter labels', () => {
    const res = {
      signatures: [
        {
          label: 'fn(a: number, b: string)',
          parameters: [{ label: 'a: number' }, { label: [14, 23] }],
          documentation: 'does a thing',
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    }
    expect(normalizeSignatureHelp(res)).toEqual({
      signatures: [
        {
          label: 'fn(a: number, b: string)',
          parameters: ['a: number', 'b: string'],
          documentation: 'does a thing',
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    })
  })

  test('defaults active indices to 0 and returns null for no signatures', () => {
    expect(normalizeSignatureHelp({ signatures: [{ label: 'x()' }] })).toEqual({
      signatures: [{ label: 'x()', parameters: [], documentation: undefined }],
      activeSignature: 0,
      activeParameter: 0,
    })
    expect(normalizeSignatureHelp({ signatures: [] })).toBeNull()
    expect(normalizeSignatureHelp(null)).toBeNull()
  })
})

describe('normalizeWorkspaceEdit', () => {
  const uriA = pathToFileURL('/proj/a.ts').href
  const uriB = pathToFileURL('/proj/b.ts').href
  const edit = (line: number, ch: number, newText: string) => ({
    range: { start: { line, character: ch }, end: { line, character: ch + 3 } },
    newText,
  })

  test('flattens the legacy `changes` map to one entry per file with absolute paths', () => {
    const res = { changes: { [uriA]: [edit(0, 4, 'Foo')], [uriB]: [edit(2, 0, 'Foo')] } }
    expect(normalizeWorkspaceEdit(res)).toEqual([
      { file: '/proj/a.ts', edits: [edit(0, 4, 'Foo')] },
      { file: '/proj/b.ts', edits: [edit(2, 0, 'Foo')] },
    ])
  })

  test('flattens `documentChanges` (TextDocumentEdit[]) and skips resource ops', () => {
    const res = {
      documentChanges: [
        { textDocument: { uri: uriA, version: 1 }, edits: [edit(1, 2, 'Bar')] },
        { kind: 'rename', oldUri: uriA, newUri: uriB }, // resource op — no `edits`, skipped
      ],
    }
    expect(normalizeWorkspaceEdit(res)).toEqual([
      { file: '/proj/a.ts', edits: [edit(1, 2, 'Bar')] },
    ])
  })

  test('drops non-file uris and malformed edits; non-object → []', () => {
    expect(normalizeWorkspaceEdit({ changes: { 'untitled:foo': [edit(0, 0, 'x')] } })).toEqual([])
    expect(normalizeWorkspaceEdit(null)).toEqual([])
  })
})

describe('normalizeCodeActions', () => {
  const uri = pathToFileURL('/proj/a.ts').href
  const editAction = (title: string) => ({
    title,
    kind: 'quickfix',
    edit: {
      changes: {
        [uri]: [
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            newText: "import x from 'x'\n",
          },
        ],
      },
    },
  })

  test('keeps quickfix CodeActions with a flattened edit', () => {
    expect(normalizeCodeActions([editAction('Add import')])).toEqual([
      {
        title: 'Add import',
        kind: 'quickfix',
        isPreferred: undefined,
        edit: [
          {
            file: '/proj/a.ts',
            edits: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                newText: "import x from 'x'\n",
              },
            ],
          },
        ],
        command: undefined,
        data: undefined,
      },
    ])
  })

  test('keeps a lazy action (no edit) carrying opaque data + isPreferred', () => {
    const [a] = normalizeCodeActions([
      { title: 'Fix spelling', kind: 'quickfix', isPreferred: true, data: { id: 7 } },
    ])
    expect(a.edit).toBeUndefined()
    expect(a.data).toEqual({ id: 7 })
    expect(a.isPreferred).toBe(true)
  })

  test('drops bare Command literals, disabled actions, and out-of-scope kinds (default quickfix)', () => {
    const res = [
      { title: 'Run command', command: 'editor.doThing', arguments: [1] }, // bare Command → skip
      { title: 'Organize imports', kind: 'source.organizeImports', edit: { changes: {} } }, // not a quickfix → skip
      { title: 'Not now', kind: 'quickfix', disabled: { reason: 'x' }, edit: { changes: {} } }, // disabled → skip
      editAction('Add import'), // kept
    ]
    // Default allowedKinds = ['quickfix'] — preserves the pre-source-actions behavior.
    const out = normalizeCodeActions(res)
    expect(out.map((a) => a.title)).toEqual(['Add import'])
  })

  test('keeps source.organizeImports when allowedKinds includes `source` (kind-prefix match)', () => {
    const res = [
      { title: 'Organize Imports', kind: 'source.organizeImports', edit: { changes: {} } },
      { title: 'Extract to function', kind: 'refactor.extract.function', edit: { changes: {} } },
      { title: 'Add import', kind: 'quickfix', edit: { changes: {} } }, // out of the requested scope → skip
    ]
    const out = normalizeCodeActions(res, ['source', 'refactor'])
    expect(out.map((a) => a.title)).toEqual(['Organize Imports', 'Extract to function'])
  })

  test('scopes to an exact sub-kind: `source.organizeImports` keeps only that, not a bare `source`', () => {
    const res = [
      { title: 'Organize Imports', kind: 'source.organizeImports', edit: { changes: {} } },
      { title: 'Fix all', kind: 'source.fixAll', edit: { changes: {} } }, // sibling sub-kind → skip
      { title: 'Generic source', kind: 'source', edit: { changes: {} } }, // parent kind → skip
    ]
    const out = normalizeCodeActions(res, ['source.organizeImports'])
    expect(out.map((a) => a.title)).toEqual(['Organize Imports'])
  })

  test('keeps a kindless action (server omitted kind on the primary fix); non-array → []', () => {
    const [a] = normalizeCodeActions([
      {
        title: 'Fix',
        edit: {
          changes: {
            [uri]: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                newText: '',
              },
            ],
          },
        },
      },
    ])
    expect(a.title).toBe('Fix')
    expect(normalizeCodeActions(null)).toEqual([])
  })
})

describe('diagnosticsOverlappingRange', () => {
  const diag = (sl: number, sc: number, el: number, ec: number): LspDiagnostic => ({
    range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
    message: 'x',
  })

  test('keeps only diagnostics overlapping the request range', () => {
    const diags = [diag(0, 0, 0, 5), diag(2, 0, 2, 5), diag(5, 0, 5, 5)]
    const range = { start: { line: 2, character: 1 }, end: { line: 2, character: 3 } }
    expect(diagnosticsOverlappingRange(diags, range)).toEqual([diag(2, 0, 2, 5)])
  })

  test('a zero-width cursor range touching a diagnostic edge counts as overlap', () => {
    const diags = [diag(3, 4, 3, 10)]
    const cursor = { start: { line: 3, character: 4 }, end: { line: 3, character: 4 } }
    expect(diagnosticsOverlappingRange(diags, cursor)).toEqual(diags)
  })
})

describe('normalizePrepareRename', () => {
  test('bare Range', () => {
    expect(
      normalizePrepareRename({ start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }),
    ).toEqual({
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
    })
  })

  test('{ range, placeholder }', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }
    expect(normalizePrepareRename({ range, placeholder: 'foo' })).toEqual({
      range,
      placeholder: 'foo',
    })
  })

  test('{ defaultBehavior: true } → null range (editor uses the word at cursor)', () => {
    expect(normalizePrepareRename({ defaultBehavior: true })).toEqual({ range: null })
  })

  test('rejection / null → null', () => {
    expect(normalizePrepareRename({ message: 'cannot rename' })).toBeNull()
    expect(normalizePrepareRename(null)).toBeNull()
  })
})
