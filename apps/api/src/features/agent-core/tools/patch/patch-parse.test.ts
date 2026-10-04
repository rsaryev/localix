import { describe, expect, it } from 'bun:test'
import { parsePatchText } from './patch-parse'
import { malformedPatchMessage } from './patch-messages'

const wrap = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`

describe('parsePatchText', () => {
  it('parses an update hunk into keep/remove/add lines', () => {
    const hunks = parsePatchText(wrap('*** Update File: src/a.ts\n@@\n keep\n-old\n+new'))
    expect(hunks).toEqual([
      {
        kind: 'update',
        path: 'src/a.ts',
        movePath: undefined,
        chunks: [
          {
            changeContext: undefined,
            oldLines: ['keep', 'old'],
            newLines: ['keep', 'new'],
            isEndOfFile: false,
          },
        ],
      },
    ])
  })

  it('parses an add-file hunk and terminates contents with a newline', () => {
    const hunks = parsePatchText(wrap('*** Add File: new.txt\n+line1\n+line2'))
    expect(hunks).toEqual([{ kind: 'add', path: 'new.txt', contents: 'line1\nline2\n' }])
  })

  it('accepts bare (no "+") content lines in an Add File block', () => {
    const hunks = parsePatchText(
      wrap('*** Add File: file1.txt\nThis is the first test file.\nIt contains several sentences.'),
    )
    expect(hunks).toEqual([
      {
        kind: 'add',
        path: 'file1.txt',
        contents: 'This is the first test file.\nIt contains several sentences.\n',
      },
    ])
  })

  it('strips a leading "+" where present but keeps bare lines literal in a mixed Add File block', () => {
    const hunks = parsePatchText(wrap('*** Add File: m.txt\n+plus line\nbare line'))
    expect(hunks).toEqual([{ kind: 'add', path: 'm.txt', contents: 'plus line\nbare line\n' }])
  })

  it('drops a stray "@@" line inside an Add File block, keeping surrounding lines as content', () => {
    const hunks = parsePatchText(wrap('*** Add File: a.txt\nbefore\n@@ anchor\nafter'))
    expect(hunks).toEqual([{ kind: 'add', path: 'a.txt', contents: 'before\nafter\n' }])
  })

  it('parses a delete-file hunk', () => {
    expect(parsePatchText(wrap('*** Delete File: gone.txt'))).toEqual([
      { kind: 'delete', path: 'gone.txt' },
    ])
  })

  it('captures a Move to target on an update', () => {
    const hunks = parsePatchText(wrap('*** Update File: old.ts\n*** Move to: new.ts\n@@\n-a\n+b'))
    expect(hunks[0]).toMatchObject({ kind: 'update', path: 'old.ts', movePath: 'new.ts' })
  })

  it('strips a surrounding ``` code fence before parsing', () => {
    const fenced = '```\n' + wrap('*** Delete File: x') + '\n```'
    expect(parsePatchText(fenced)).toEqual([{ kind: 'delete', path: 'x' }])
  })

  it('repairs a missing *** End Patch marker', () => {
    expect(parsePatchText('*** Begin Patch\n*** Delete File: x')).toEqual([
      { kind: 'delete', path: 'x' },
    ])
  })

  it('skips preamble before *** Begin Patch', () => {
    expect(parsePatchText('chatter\n' + wrap('*** Delete File: x'))).toEqual([
      { kind: 'delete', path: 'x' },
    ])
  })

  it('uses tolerant marker matching when a preamble precedes the envelope', () => {
    expect(
      parsePatchText(
        'I will apply this now:\n*** begin   patch ***\n*** Delete File: x\n*** end patch ***',
      ),
    ).toEqual([{ kind: 'delete', path: 'x' }])
  })

  it('ignores transport text after End Patch', () => {
    expect(parsePatchText(wrap('*** Delete File: x') + '\n```\nPatch applied.')).toEqual([
      { kind: 'delete', path: 'x' },
    ])
  })

  it('unwraps shell heredoc syntax copied into the patch argument', () => {
    expect(
      parsePatchText("apply_patch <<'PATCH'\n" + wrap('*** Delete File: x') + '\nPATCH'),
    ).toEqual([{ kind: 'delete', path: 'x' }])
  })

  it('unwraps a JSON-stringified patch or patch object', () => {
    const patch = wrap('*** Delete File: x')
    expect(parsePatchText(JSON.stringify(patch))).toEqual([{ kind: 'delete', path: 'x' }])
    expect(parsePatchText(JSON.stringify({ patch }))).toEqual([{ kind: 'delete', path: 'x' }])
  })

  it('accepts an input BOM, surrounding whitespace, and CRLF line endings', () => {
    expect(
      parsePatchText('\uFEFF  *** Begin Patch\r\n*** Delete File: x\r\n*** End Patch  \r\n'),
    ).toEqual([{ kind: 'delete', path: 'x' }])
  })

  it('tolerates mirrored trailing asterisks on markers and headers', () => {
    const hunks = parsePatchText(
      '*** Begin Patch ***\n*** Update File: a.ts ***\n@@\n-a\n+b\n*** End Patch ***',
    )
    expect(hunks[0]).toMatchObject({ kind: 'update', path: 'a.ts' })
  })

  it('throws on empty input', () => {
    expect(() => parsePatchText('')).toThrow('Patch is empty')
  })

  it('names raw unified-diff syntax so the model corrects fast', () => {
    expect(() => parsePatchText(wrap('--- a/x.ts'))).toThrow(/unified-diff syntax/)
  })

  it('throws when no hunks are present', () => {
    expect(() => parsePatchText('*** Begin Patch\n*** End Patch')).toThrow(
      'does not contain any hunks',
    )
  })

  it('merges multiple concatenated Begin/End envelopes into one hunk list', () => {
    const multiEnvelope = `*** Begin Patch
*** Update File: a.md
@@
 context
-old line
+new line
 more context
*** End Patch
*** Begin Patch
*** Delete File: b.md
*** End Patch
*** Begin Patch
*** Move to: c.md -> d.md
*** End Patch`
    const hunks = parsePatchText(multiEnvelope)
    expect(hunks).toHaveLength(3)
    expect(hunks[0]).toMatchObject({ kind: 'update', path: 'a.md', movePath: undefined })
    expect(hunks[1]).toEqual({ kind: 'delete', path: 'b.md' })
    expect(hunks[2]).toEqual({ kind: 'update', path: 'c.md', movePath: 'd.md', chunks: [] })
  })

  it('merges a two-envelope add + add into two hunks', () => {
    const twoEnvelope = `*** Begin Patch
*** Add File: x.md
+hello
*** End Patch
*** Begin Patch
*** Add File: y.md
+world
*** End Patch`
    expect(parsePatchText(twoEnvelope)).toEqual([
      { kind: 'add', path: 'x.md', contents: 'hello\n' },
      { kind: 'add', path: 'y.md', contents: 'world\n' },
    ])
  })

  it('keeps the single-envelope multi-file path unchanged', () => {
    const single = `*** Begin Patch
*** Add File: x.md
+hello
*** Add File: y.md
+world
*** End Patch`
    expect(parsePatchText(single)).toEqual([
      { kind: 'add', path: 'x.md', contents: 'hello\n' },
      { kind: 'add', path: 'y.md', contents: 'world\n' },
    ])
  })

  it('treats a standalone "Move to: <old> -> <new>" as a pure rename (no content change)', () => {
    const hunks = parsePatchText(wrap('*** Move to: old/name.ts -> new/name.ts'))
    expect(hunks).toEqual([
      { kind: 'update', path: 'old/name.ts', movePath: 'new/name.ts', chunks: [] },
    ])
  })

  it('errors with the correct syntax when a standalone Move omits the second path', () => {
    expect(() => parsePatchText(wrap('*** Move to: only-one.ts'))).toThrow(
      /standalone Move needs both paths/,
    )
  })

  it('teaches the envelope shape on an unrecognized header line', () => {
    expect(() => parsePatchText(wrap('*** Rename File: a.ts'))).toThrow(
      /multiple "\*\*\* Begin Patch"/,
    )
  })

  // A model (deepseek-v4-flash was the repro) wraps a raw `git diff` INSIDE the
  // apply_patch envelope — a HYBRID patch. The "--- a/x" / "+++ b/x" file headers
  // must be skipped, not parsed as a "-"-delete of "-- a/x" / "+"-add of "++ b/x".
  it('skips leaked "--- a/… / +++ b/…" file headers in a hybrid update patch', () => {
    const hybrid = `*** Begin Patch ***
*** Update File: index.html ***
--- a/index.html
+++ b/index.html
@@ -5,6 +5,49 @@
   <style>
     *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
+    :root { --bg: #fff; }
   </style>
*** End Patch ***`
    const hunks = parsePatchText(hybrid)
    expect(hunks).toEqual([
      {
        kind: 'update',
        path: 'index.html',
        movePath: undefined,
        chunks: [
          {
            changeContext: undefined,
            oldLines: [
              '  <style>',
              '    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
              '  </style>',
            ],
            newLines: [
              '  <style>',
              '    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
              '    :root { --bg: #fff; }',
              '  </style>',
            ],
            isEndOfFile: false,
          },
        ],
      },
    ])
    // The regression: the header must NOT survive as a phantom first chunk.
    const update = hunks[0] as { chunks: { oldLines: string[]; newLines: string[] }[] }
    expect(update.chunks).toHaveLength(1)
    expect(update.chunks[0].oldLines).not.toContain('-- a/index.html')
    expect(update.chunks[0].newLines).not.toContain('++ b/index.html')
  })

  it('skips "diff --git" and "index <sha>..<sha>" metadata lines in an update patch', () => {
    const hunks = parsePatchText(
      wrap(
        `*** Update File: app.ts
diff --git a/app.ts b/app.ts
index 1a2b3c4..5d6e7f8 100644
--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,3 @@
 keep
-old
+new`,
      ),
    )
    expect(hunks).toEqual([
      {
        kind: 'update',
        path: 'app.ts',
        movePath: undefined,
        chunks: [
          {
            changeContext: undefined,
            oldLines: ['keep', 'old'],
            newLines: ['keep', 'new'],
            isEndOfFile: false,
          },
        ],
      },
    ])
  })

  it('tolerates "--no-prefix" file headers whose path matches the target', () => {
    const hunks = parsePatchText(
      wrap(`*** Update File: src/app.ts
--- src/app.ts
+++ src/app.ts
@@
 keep
-old
+new`),
    )
    expect(hunks[0]).toMatchObject({
      kind: 'update',
      path: 'src/app.ts',
      chunks: [{ oldLines: ['keep', 'old'], newLines: ['keep', 'new'] }],
    })
  })

  it('still parses genuine "-" content lines that start with "--" as deletions', () => {
    // "--foo" and "- --" are real deletions, NOT git file headers — they must survive.
    const hunks = parsePatchText(
      wrap('*** Update File: cfg.yml\n@@\n keep\n---\n--foo\n- --\n+added'),
    )
    expect(hunks[0]).toMatchObject({
      kind: 'update',
      path: 'cfg.yml',
      chunks: [{ oldLines: ['keep', '--', '-foo', ' --'], newLines: ['keep', 'added'] }],
    })
  })

  it('skips leaked git headers ("/dev/null", "new file mode") in a hybrid Add File patch', () => {
    const hunks = parsePatchText(
      wrap(
        `*** Add File: new.txt
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.txt
+line1
+line2`,
      ),
    )
    expect(hunks).toEqual([{ kind: 'add', path: 'new.txt', contents: 'line1\nline2\n' }])
  })

  // Weak models (tencent/hy3-preview) write decorative "***"
  // NARRATION lines — a bare "***"/"*** " separator or "*** prose" — between the file
  // directive and the first hunk, and between hunks. They must be skipped, not parsed
  // as a new file section (which broke the hunk with "Update file hunk … is empty").
  it('skips "***" narration between a file directive and its first hunk', () => {
    const notes: string[] = []
    const hunks = parsePatchText(
      wrap(
        '*** Update File: s.js\n*** \n*** Update the beginning of the file\n***\n@@\n-const a = 1;\n+const a = 2;',
      ),
      notes,
    )
    expect(hunks).toEqual([
      {
        kind: 'update',
        path: 's.js',
        movePath: undefined,
        chunks: [
          {
            changeContext: undefined,
            oldLines: ['const a = 1;'],
            newLines: ['const a = 2;'],
            isEndOfFile: false,
          },
        ],
      },
    ])
    expect(notes.some((n) => /ignored 3 decorative/.test(n))).toBe(true)
  })

  it('skips "***" narration between two hunks of the same file', () => {
    const hunks = parsePatchText(
      wrap('*** Update File: s.js\n@@\n-a\n+A\n*** \n*** second edit\n***\n@@\n-b\n+B'),
    )
    const update = hunks[0] as { chunks: { oldLines: string[]; newLines: string[] }[] }
    expect(update.chunks).toHaveLength(2)
    expect(update.chunks[0]).toMatchObject({ oldLines: ['a'], newLines: ['A'] })
    expect(update.chunks[1]).toMatchObject({ oldLines: ['b'], newLines: ['B'] })
  })

  it('lets a bare "***" narration line terminate a hunk body without capturing it as content', () => {
    const hunks = parsePatchText(wrap('*** Update File: s.js\n@@\n-a\n+A\n***\n*** trailing note'))
    const update = hunks[0] as { chunks: { oldLines: string[]; newLines: string[] }[] }
    expect(update.chunks).toHaveLength(1)
    expect(update.chunks[0].oldLines).toEqual(['a'])
    expect(update.chunks[0].newLines).toEqual(['A'])
    // The regression: the bare "***" must NOT survive as a context line.
    expect([...update.chunks[0].oldLines, ...update.chunks[0].newLines]).not.toContain('***')
  })

  it('still errors when a patch is only "***" narration with no real hunks', () => {
    expect(() =>
      parsePatchText('*** Begin Patch\n*** \n*** just a comment\n***\n*** End Patch'),
    ).toThrow(/does not contain any hunks/)
  })

  it('does NOT treat a misspelled file directive as narration — it still teaches the format', () => {
    // "*** Rename File:" is directive-SHAPED (wrong keyword), not decorative prose —
    // skipping it would silently drop the model's file-operation intent.
    expect(() => parsePatchText(wrap('*** \n*** Rename File: a.ts'))).toThrow(
      /multiple "\*\*\* Begin Patch"/,
    )
  })

  // The verbatim first failing patch from a live weak-model run: two "@@ -N,N +N,N @@" hunks,
  // wrapped in narration, must parse into exactly two clean chunks with no narration
  // surviving as content (the accumulating verbatim-patch corpus).
  it('parses the verbatim narrated patch #1 (narration + two unified hunks) cleanly', () => {
    const patch1 = [
      '*** Begin Patch',
      '*** Update File: /w/script.js',
      '*** ',
      '*** Update the beginning of the file to wrap all code in DOMContentLoaded',
      '*** ',
      '@@ -1,3 +1,4 @@',
      '-// Theme Switching Functionality',
      "-const themeToggle = document.getElementById('themeToggle');",
      '+// Wait for DOM to be fully loaded',
      "+document.addEventListener('DOMContentLoaded', function() {",
      "+    const themeToggle = document.getElementById('themeToggle');",
      '*** ',
      '*** Update the end of the file to close the DOMContentLoaded wrapper',
      '***',
      '@@ -71,2 +73,3 @@',
      '     });',
      "-console.log('done');",
      "+    console.log('done');",
      '+});',
    ].join('\n')
    const notes: string[] = []
    const hunks = parsePatchText(patch1, notes)
    const update = hunks[0] as {
      path: string
      chunks: { oldLines: string[]; newLines: string[] }[]
    }
    expect(hunks).toHaveLength(1)
    expect(update.chunks).toHaveLength(2)
    const allBody = update.chunks.flatMap((c) => [...c.oldLines, ...c.newLines])
    expect(allBody.some((l) => l.trim().startsWith('***'))).toBe(false)
    expect(allBody.some((l) => l.includes('Update the beginning'))).toBe(false)
    expect(notes.some((n) => /ignored 6 decorative/.test(n))).toBe(true)
  })
})

describe('malformedPatchMessage', () => {
  it('teaches the ADD shape (not the Update template) for a pure-add patch failure', () => {
    const msg = malformedPatchMessage('Patch is empty', wrap('*** Add File: f.txt'))
    expect(msg).toContain('To create a NEW file')
    expect(msg).toContain('*** Add File: <path>')
    expect(msg).toContain('bare lines are accepted')
    expect(msg).not.toContain('unchanged context line')
  })

  it('teaches the Update template for an update-style failure', () => {
    const msg = malformedPatchMessage('Expected @@ marker', wrap('*** Update File: f.txt'))
    expect(msg).toContain('*** Update File: <path>')
    expect(msg).toContain('unchanged context line')
    expect(msg).not.toContain('To create a NEW file')
  })
})

// Model-formatting drift measured across the recorded apply_patch corpus: these
// six shapes accounted for 8 of the 15 patches the parser used to reject outright,
// each costing a full turn to teach syntax we can infer instead.
describe('parsePatchText — tolerated model drift', () => {
  it('takes the git function-context after the closing @@ as the anchor', () => {
    const hunks = parsePatchText(
      wrap('*** Update File: a.ts\n@@ -1,7 +1,9 @@ function foo()\n keep\n+new'),
    )
    expect(
      (hunks[0] as { chunks: Array<{ changeContext?: string }> }).chunks[0].changeContext,
    ).toBe('function foo()')
  })

  it('ignores a garbled positional hunk header ("@@ line 117,1 +117,1 @@")', () => {
    const hunks = parsePatchText(
      wrap('*** Update File: a.ts\n@@ line 117,1 +117,1 @@\n keep\n+new'),
    )
    expect(
      (hunks[0] as { chunks: Array<{ changeContext?: string }> }).chunks[0].changeContext,
    ).toBeUndefined()
  })

  it('starts a follow-on chunk with no "@@" separator', () => {
    // Narration ends the first chunk's body; the next chunk then opens straight at
    // its "-" line. Chunks apply positionally from the previous match, so the "@@"
    // separator was never load-bearing — rejecting the patch over it was pure waste.
    const hunks = parsePatchText(
      wrap(
        '*** Update File: a.ts\n@@\n keep\n-old\n+new\n*** and now the status\n- ## Status\n+ ## Done',
      ),
    )
    expect((hunks[0] as { chunks: unknown[] }).chunks).toHaveLength(2)
  })

  it('drops a trailing body-less "@@" anchor instead of failing the patch', () => {
    const notes: string[] = []
    const hunks = parsePatchText(
      wrap('*** Update File: a.ts\n@@ type Foo {\n-old\n+new\n@@ toggle } {'),
      notes,
    )
    expect((hunks[0] as { chunks: unknown[] }).chunks).toHaveLength(1)
    expect(notes.join(' ')).toContain('body-less "@@" anchor')
  })

  it('accepts a split "*** File: <path>" / "*** Update File" header pair', () => {
    const hunks = parsePatchText(wrap('*** File: src/a.ts\n*** Update File\n@@\n keep\n+new'))
    expect(hunks[0]).toMatchObject({ kind: 'update', path: 'src/a.ts' })
  })

  it('ignores a restated "*** Begin Patch" partway through the envelope', () => {
    const hunks = parsePatchText(
      wrap('*** Update File: a.ts\n@@\n keep\n+new\n*** Begin Patch\n*** Delete File: b.ts'),
    )
    expect(hunks.map((h) => h.kind)).toEqual(['update', 'delete'])
  })
})

describe('parsePatchText — raw unified/git diff normalization', () => {
  it('infers the file directive from "---"/"+++" headers', () => {
    const notes: string[] = []
    const hunks = parsePatchText('--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-old\n+new', notes)
    expect(hunks[0]).toMatchObject({ kind: 'update', path: 'src/x.ts' })
    expect(notes.join(' ')).toContain('normalized a unified/git diff')
  })

  it('maps /dev/null sides to Add and Delete, and a rename to a Move', () => {
    const hunks = parsePatchText(
      [
        'diff --git a/new.ts b/new.ts',
        '--- /dev/null',
        '+++ b/new.ts',
        '@@ -0,0 +1 @@',
        '+hello',
        'diff --git a/gone.ts b/gone.ts',
        '--- a/gone.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-bye',
        'diff --git a/old.ts b/renamed.ts',
        'similarity index 100%',
        'rename from old.ts',
        'rename to renamed.ts',
      ].join('\n'),
    )
    expect(hunks).toEqual([
      { kind: 'add', path: 'new.ts', contents: 'hello\n' },
      { kind: 'delete', path: 'gone.ts' },
      { kind: 'update', path: 'old.ts', movePath: 'renamed.ts', chunks: [] },
    ])
  })

  it('leaves a directive-bearing patch alone — a stray diff header there stays an error', () => {
    expect(() =>
      parsePatchText(wrap('*** Delete File: a.ts\n--- b/other.ts\n+++ b/other.ts')),
    ).toThrow(/unified-diff syntax/)
  })

  it('does not treat a lone "--- a/x" as a delete', () => {
    expect(() => parsePatchText(wrap('--- a/x.ts'))).toThrow(/unified-diff syntax/)
  })
})

describe('envelope-less and mis-headed patches (recorded corpus)', () => {
  it('a patch that is only file directives gets its envelope supplied', () => {
    const notes: string[] = []
    const hunks = parsePatchText(
      ['*** Add File: doc1.md', 'first', '', '*** Add File: doc2.md', 'second'].join('\n'),
      notes,
    )
    expect(hunks.map((h) => h.path)).toEqual(['doc1.md', 'doc2.md'])
    expect(notes.join(' ')).toContain('missing its "*** Begin Patch"')
  })

  it('a body that is NOT a file directive still demands the envelope', () => {
    // Never guess: bare prose is not a patch, and silently wrapping it would turn a
    // clear error into a confusing one.
    expect(() => parsePatchText('just some text\n+added')).toThrow(/must be '\*\*\* Begin Patch'/)
  })

  it('a standalone "Move to" carrying hunks is read as rename + edit', () => {
    const notes: string[] = []
    const hunks = parsePatchText(
      ['*** Begin Patch', '*** Move to: c.md -> c2.md', ' keep', '+added', '*** End Patch'].join(
        '\n',
      ),
      notes,
    )
    expect(hunks).toHaveLength(1)
    const hunk = hunks[0]
    expect(hunk).toMatchObject({ kind: 'update', path: 'c.md', movePath: 'c2.md' })
    // PatchHunk is a union and only `update` carries chunks; toMatchObject asserts but
    // does not NARROW, so narrow for real — otherwise `.chunks` is being read off a
    // union member (add/delete) that has no such field.
    if (hunk.kind !== 'update') throw new Error(`expected an update hunk, got ${hunk.kind}`)
    expect(hunk.chunks[0]).toMatchObject({ oldLines: ['keep'], newLines: ['keep', 'added'] })
    expect(notes.join(' ')).toContain('carried an edit')
  })

  it('a standalone "Move to" with no body stays a pure rename', () => {
    const hunks = parsePatchText(
      ['*** Begin Patch', '*** Move to: a.md -> b.md', '*** End Patch'].join('\n'),
    )
    expect(hunks[0]).toMatchObject({ path: 'a.md', movePath: 'b.md', chunks: [] })
  })

  it('an Update with no diff lines points at `write` instead of just "is empty"', () => {
    // The recorded failure: the model wrote the whole new file body under
    // "*** Update File:", which apply_patch cannot express.
    expect(() =>
      parsePatchText(
        [
          '*** Begin Patch',
          '*** Update File: one.md',
          '*** End of File',
          'whole new body',
          '*** End Patch',
        ].join('\n'),
      ),
    ).toThrow(/use the `write` tool/)
  })
})
