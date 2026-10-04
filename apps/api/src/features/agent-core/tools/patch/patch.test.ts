import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPatchTool } from './patch'
import { createReadTool } from '../file/read'
import { createFileMtimeStore, invalidateFileMtime } from '../file/file-utils'
import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'

describe('createPatchTool', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-apply-patch-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('a git diff wrapped in the envelope, with no file directive, is normalized and applied', async () => {
    // 27% of apply_patch calls failed on exactly this: the model emits a raw diff.
    // The path is in the "---"/"+++" headers, so infer it instead of burning a turn.
    await writeFile(path.join(tempDir, 'foo.ts'), 'x\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-x', {
      patch: [
        '*** Begin Patch',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1 +1 @@',
        '-x',
        '+y',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('normalized a unified/git diff')
    expect(await readFile(path.join(tempDir, 'foo.ts'), 'utf8')).toBe('y\n')
  })

  test('a context miss on a file this session never read names the real cause', async () => {
    // 13 of the 65 recorded "Failed to locate the context" failures patched a file the
    // agent had never read; the generic hint sent it to fiddle with whitespace on lines
    // it had invented, so it retried and failed again.
    await writeFile(path.join(tempDir, 'unseen.ts'), 'real line\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-unseen', {
      patch: [
        '*** Begin Patch',
        '*** Update File: unseen.ts',
        '-imagined line',
        '+new',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('have not read')
    expect(result.content).toContain('came from memory')
  })

  test('the error never both bans and demands a re-read', async () => {
    // A large file: only the closest REGION is shown, so banning a re-read would
    // strand the model — and it directly contradicted the "read it first" diagnosis.
    await writeFile(
      path.join(tempDir, 'large.ts'),
      `${Array.from({ length: 80 }, (_, i) => `real ${i + 1}`).join('\n')}\n`,
      'utf8',
    )
    const tool = createPatchTool(undefined, tempDir)
    const large = await tool.execute('p-large', {
      patch: [
        '*** Begin Patch',
        '*** Update File: large.ts',
        '-imagined',
        '+new',
        '*** End Patch',
      ].join('\n'),
    })
    expect(large.content).not.toContain('do NOT re-read')
    expect(large.content).toContain('read the file')

    // A small file is printed IN the error, so a re-read really is unnecessary — and
    // the unread-file diagnosis must not then order one.
    await writeFile(path.join(tempDir, 'tiny.ts'), 'real a\nreal b\n', 'utf8')
    const tiny = await tool.execute('p-tiny', {
      patch: [
        '*** Begin Patch',
        '*** Update File: tiny.ts',
        '-imagined',
        '+new',
        '*** End Patch',
      ].join('\n'),
    })
    expect(tiny.content).toContain('no re-read needed')
    expect(tiny.content).toContain('Use the real lines printed above')
    expect(tiny.content).not.toContain('Read it first')
  })

  test('the same miss on a file that WAS read carries no such claim', async () => {
    await writeFile(path.join(tempDir, 'seen.ts'), 'real line\n', 'utf8')
    const mtimes = createFileMtimeStore()
    const read = createReadTool(undefined, tempDir, undefined, undefined, undefined, mtimes)
    const tool = createPatchTool(undefined, tempDir, undefined, undefined, mtimes)
    await read.execute('r1', { path: 'seen.ts' })
    const result = await tool.execute('tool-seen', {
      patch: [
        '*** Begin Patch',
        '*** Update File: seen.ts',
        '-imagined line',
        '+new',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).not.toContain('have not read')
  })

  test('a context miss after a USER edit names the user, not a whitespace typo', async () => {
    // The session read the file, the user then saved it in the editor
    // (invalidateFileMtime dropped the record), and the patch's context — copied
    // from the version the agent read — no longer matches. The "you have not read"
    // diagnosis would be a lie here; say the user may have edited it instead.
    const filePath = path.join(tempDir, 'edited.ts')
    await writeFile(filePath, 'const a = 1\nconst b = 2\n', 'utf8')
    const mtimes = createFileMtimeStore()
    const read = createReadTool(undefined, tempDir, undefined, undefined, undefined, mtimes)
    const tool = createPatchTool(undefined, tempDir, undefined, undefined, mtimes)
    await read.execute('r-edited', { path: 'edited.ts' })

    // The user's edit: content replaced through a route no agent tool observed.
    await writeFile(filePath, 'const a = 10\nconst b = 2\n', 'utf8')
    invalidateFileMtime(filePath)

    const result = await tool.execute('tool-edited', {
      patch: [
        '*** Begin Patch',
        '*** Update File: edited.ts',
        '-const a = 1',
        '+const a = 2',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('user may have edited')
    expect(result.content).not.toContain('have not read')
    // The tiny file is printed in the error, so the diagnosis points at it as current.
    expect(result.content).toContain('CURRENT content')
  })

  test('unicode confusables in the file match ASCII patch context, with an explicit note', async () => {
    // The file holds smart quotes, an em-dash, and a non-breaking space; the model
    // (or a copy-paste) wrote plain ASCII. The normalization ladder must find the
    // line, apply the edit there, leave every other line's bytes untouched, and
    // SAY that normalization was used.
    const filePath = path.join(tempDir, 'uni.ts')
    const untouched = 'const keep = ‘fancy’\n'
    await writeFile(
      filePath,
      `${untouched}const title = “Smart — Quotes”\nconst tail = 1\n`,
      'utf8',
    )
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-uni', {
      patch: [
        '*** Begin Patch',
        '*** Update File: uni.ts',
        '-const title = "Smart - Quotes"',
        '+const title = "Plain"',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('unicode-normalization')
    const after = await readFile(filePath, 'utf8')
    // The replaced line carries the patch's new text; bytes outside it are preserved.
    expect(after).toBe(`${untouched}const title = "Plain"\nconst tail = 1\n`)
  })

  test('a bare unified diff with no envelope at all is normalized and applied', async () => {
    await writeFile(path.join(tempDir, 'bare.ts'), 'x\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-bare', {
      patch: ['--- bare.ts', '+++ bare.ts', '@@ -1 +1 @@', '-x', '+y'].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'bare.ts'), 'utf8')).toBe('y\n')
  })

  test('a git diff that creates, deletes and renames files normalizes to the right directives', async () => {
    await writeFile(path.join(tempDir, 'gone.ts'), 'bye\n', 'utf8')
    await writeFile(path.join(tempDir, 'old.ts'), 'keep\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-multi', {
      patch: [
        'diff --git a/new.ts b/new.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.ts',
        '@@ -0,0 +1,2 @@',
        '+hello',
        '+world',
        'diff --git a/gone.ts b/gone.ts',
        'deleted file mode 100644',
        '--- a/gone.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-bye',
        'diff --git a/old.ts b/renamed.ts',
        'similarity index 100%',
        'rename from old.ts',
        'rename to renamed.ts',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'new.ts'), 'utf8')).toBe('hello\nworld\n')
    expect(await Bun.file(path.join(tempDir, 'gone.ts')).exists()).toBe(false)
    expect(await readFile(path.join(tempDir, 'renamed.ts'), 'utf8')).toBe('keep\n')
  })

  test('a stray diff header inside a directive-bearing patch still teaches the envelope', async () => {
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-stray', {
      patch: [
        '*** Begin Patch',
        '*** Delete File: a.ts',
        '--- b/other.ts',
        '+++ b/other.ts',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('git/unified-diff syntax')
    expect(result.content).toContain('*** Update File')
  })

  test('creates a file with *** Add File', async () => {
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-1', {
      patch: [
        '*** Begin Patch',
        '*** Add File: notes/todo.txt',
        '+hello',
        '+world',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'notes/todo.txt'), 'utf8')).toBe('hello\nworld\n')
    expect(result.details).toMatchObject({
      totalFiles: 1,
      additions: 2,
      deletions: 0,
    })
  })

  test('applies a HYBRID patch (git-diff headers inside the envelope) end-to-end', async () => {
    const filePath = path.join(tempDir, 'index.html')
    await writeFile(filePath, 'one\ntwo\nthree\nfour\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-hybrid', {
      patch: [
        '*** Begin Patch ***',
        '*** Update File: index.html ***',
        '--- a/index.html',
        '+++ b/index.html',
        '@@ -1,4 +1,5 @@',
        ' one',
        ' two',
        '+inserted',
        ' three',
        ' four',
        '*** End Patch ***',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('one\ntwo\ninserted\nthree\nfour\n')
  })

  // Verbatim first failing patch from a live run (model tencent/hy3-preview):
  // decorative "***" narration lines between the file directive and the first hunk,
  // and between the two "@@ -N,N +N,N @@" hunks. Path adapted to the sandbox; the
  // narration/hunk structure is verbatim. Previously died with "Update file hunk … is
  // empty"; must now apply both hunks correctly and note the ignored narration.
  test('applies the verbatim narrated patch #1 (narration + two unified hunks)', async () => {
    const filePath = path.join(tempDir, 'script.js')
    await writeFile(
      filePath,
      [
        '// Theme Switching Functionality',
        "const themeToggle = document.getElementById('themeToggle');",
        "const themeIcon = themeToggle.querySelector('.theme-icon');",
        '',
        '// Check for saved theme preference or default to light',
        "const currentTheme = localStorage.getItem('theme') || 'light';",
        "document.documentElement.setAttribute('data-theme', currentTheme);",
        'updateThemeIcon(currentTheme);',
        '',
        '        observer.observe(el);',
        '    });',
        '',
        "console.log('AudioPro Cyprus landing page loaded successfully! 🎧');",
        '',
      ].join('\n'),
      'utf8',
    )
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-narration-1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: script.js',
        '*** ',
        '*** Update the beginning of the file to wrap all code in DOMContentLoaded',
        '*** ',
        '@@ -1,10 +1,12 @@',
        '-// Theme Switching Functionality',
        "-const themeToggle = document.getElementById('themeToggle');",
        "-const themeIcon = themeToggle.querySelector('.theme-icon');",
        '+// Wait for DOM to be fully loaded',
        "+document.addEventListener('DOMContentLoaded', function() {",
        '+    // Theme Switching Functionality',
        "+    const themeToggle = document.getElementById('themeToggle');",
        "+    const themeIcon = themeToggle.querySelector('.theme-icon');",
        ' ',
        '-// Check for saved theme preference or default to light',
        "-const currentTheme = localStorage.getItem('theme') || 'light';",
        "-document.documentElement.setAttribute('data-theme', currentTheme);",
        '-updateThemeIcon(currentTheme);',
        '+    // Check for saved theme preference or default to light',
        "+    const currentTheme = localStorage.getItem('theme') || 'light';",
        "+    document.documentElement.setAttribute('data-theme', currentTheme);",
        '+    updateThemeIcon(currentTheme);',
        ' ',
        '*** ',
        '*** Update the end of the file to close the DOMContentLoaded wrapper',
        '***',
        '@@ -71,4 +73,4 @@',
        '         observer.observe(el);',
        '     });',
        ' ',
        "-console.log('AudioPro Cyprus landing page loaded successfully! 🎧');",
        "+    console.log('AudioPro Cyprus landing page loaded successfully! 🎧');",
        '+});',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    const out = await readFile(filePath, 'utf8')
    expect(out).toBe(
      [
        '// Wait for DOM to be fully loaded',
        "document.addEventListener('DOMContentLoaded', function() {",
        '    // Theme Switching Functionality',
        "    const themeToggle = document.getElementById('themeToggle');",
        "    const themeIcon = themeToggle.querySelector('.theme-icon');",
        '',
        '    // Check for saved theme preference or default to light',
        "    const currentTheme = localStorage.getItem('theme') || 'light';",
        "    document.documentElement.setAttribute('data-theme', currentTheme);",
        '    updateThemeIcon(currentTheme);',
        '',
        '        observer.observe(el);',
        '    });',
        '',
        "    console.log('AudioPro Cyprus landing page loaded successfully! 🎧');",
        '});',
        '',
      ].join('\n'),
    )
    // The narration must not leak into the file, and the model is told it was ignored.
    expect(out).not.toContain('***')
    expect(out).not.toContain('Update the beginning')
    expect(result.content).toContain('narration')
  })

  // Verbatim-shape second failing patch from the same run (index.html): narration, then
  // a NO-OP first hunk (byte-identical "-"/"+" lines) followed by the real edit. The
  // no-op must be skipped (it would otherwise consume the anchor and fail the real
  // hunk); the onclick handler must land; both skips are noted.
  test('applies the narrated patch #2 shape (narration + no-op hunk + real hunk)', async () => {
    const filePath = path.join(tempDir, 'index.html')
    await writeFile(
      filePath,
      [
        '<header>',
        '    <button class="theme-toggle" id="themeToggle">',
        '        <span class="theme-icon">🌙</span>',
        '    </button>',
        '</header>',
        '',
      ].join('\n'),
      'utf8',
    )
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-narration-2', {
      patch: [
        '*** Begin Patch',
        '*** Update File: index.html',
        '*** ',
        '*** Add onclick handler directly to the theme toggle button in HTML',
        '***',
        '@@',
        '-    <button class="theme-toggle" id="themeToggle">',
        '+    <button class="theme-toggle" id="themeToggle">',
        '         <span class="theme-icon">🌙</span>',
        '@@',
        '-    <button class="theme-toggle" id="themeToggle">',
        '+    <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()">',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    const out = await readFile(filePath, 'utf8')
    expect(out).toBe(
      [
        '<header>',
        '    <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()">',
        '        <span class="theme-icon">🌙</span>',
        '    </button>',
        '</header>',
        '',
      ].join('\n'),
    )
    expect(result.content).toContain('no-op')
    expect(result.content).toContain('narration')
  })

  test('inserts lines after @@ anchor for update hunks', async () => {
    const filePath = path.join(tempDir, 'example.ts')
    await writeFile(filePath, 'alpha\nbeta\ngamma\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-2', {
      patch: [
        '*** Begin Patch',
        '*** Update File: example.ts',
        '@@ beta',
        '+inserted',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('alpha\nbeta\ninserted\ngamma\n')
  })

  test('applies a hunk despite indentation drift, preserving the file indentation', async () => {
    // File uses 4-space indent; the model wrote the patch with consistent 2-space
    // content (each diff line is "<prefix-char><2-space content>").
    const filePath = path.join(tempDir, 'indent.ts')
    await writeFile(filePath, 'function f() {\n    const x = 1\n    return x\n}\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-indent', {
      patch: [
        '*** Begin Patch',
        '*** Update File: indent.ts',
        '   const x = 1', // context: 1 prefix space + 2-space content
        '-  return x', // removed: 2-space content
        '+  return x + 1', // added: 2-space content
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    // The replacement should land at the file's 4-space indentation, not 2.
    expect(await readFile(filePath, 'utf8')).toBe(
      'function f() {\n    const x = 1\n    return x + 1\n}\n',
    )
  })

  // Weak-model diff-construction repairs: the model
  // splits one file line into fragments, or repeats a line as both context and a
  // "-" removal. apply_patch now rescues these when unambiguous.
  test('rescues a line the model split into fragments (S3)', async () => {
    const filePath = path.join(tempDir, 'x.md')
    await writeFile(filePath, 'This is the UPDATED first file.\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-s3', {
      patch: [
        '*** Begin Patch',
        '*** Update File: x.md',
        ' This is the',
        '-UPDATED',
        '+MODIFIED',
        ' first file.',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('This is the MODIFIED first file.\n')
  })

  test('rescues a line repeated as both context and "-" (S5)', async () => {
    const filePath = path.join(tempDir, 'app.py')
    await writeFile(filePath, 'def add(a, b):\n    return a + b\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-s5', {
      patch: [
        '*** Begin Patch',
        '*** Update File: app.py',
        ' def add(a, b):',
        '+def sub(a, b):',
        '+    return a - b',
        '+',
        '+',
        '-def add(a, b):',
        '+def plus(a, b):',
        '     return a + b',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    const out = await readFile(filePath, 'utf8')
    expect(out).toContain('def sub(a, b):')
    expect(out).toContain('def plus(a, b):')
    expect(out).not.toContain('def add(a, b):')
  })

  test('an ambiguous fragment still fails loudly with a whole-file hint', async () => {
    const filePath = path.join(tempDir, 'amb.ts')
    await writeFile(filePath, 'let x = 1 here\nconst x = 1 there\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-amb', {
      patch: [
        '*** Begin Patch',
        '*** Update File: amb.ts',
        ' x',
        '-= 1',
        '+= 2',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Failed to locate the context block')
    // File is unchanged — no silent misapply.
    expect(await readFile(filePath, 'utf8')).toBe('let x = 1 here\nconst x = 1 there\n')
  })

  test('falls through to content matching when the @@ anchor is not found verbatim', async () => {
    const filePath = path.join(tempDir, 'anchor.ts')
    await writeFile(filePath, 'alpha\nbeta\ngamma\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-anchor', {
      patch: [
        '*** Begin Patch',
        '*** Update File: anchor.ts',
        '@@ this anchor does not exist',
        '-beta',
        '+beta-changed',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('alpha\nbeta-changed\ngamma\n')
  })

  test('applies a near-miss context via fuzzy matching', async () => {
    const filePath = path.join(tempDir, 'fuzzy.ts')
    await writeFile(filePath, 'const greeting = "hello world"\nexport default greeting\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    // Context has a small typo ("helo") but is otherwise the line.
    const result = await tool.execute('tool-fuzzy', {
      patch: [
        '*** Begin Patch',
        '*** Update File: fuzzy.ts',
        '-const greeting = "helo world"',
        '+const greeting = "hi world"',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe(
      'const greeting = "hi world"\nexport default greeting\n',
    )
  })

  test('returns a retryable, actionable error when context cannot be found', async () => {
    const filePath = path.join(tempDir, 'missing.ts')
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-miss', {
      patch: [
        '*** Begin Patch',
        '*** Update File: missing.ts',
        '-this line is nowhere in the file at all',
        '+replacement',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBe(true)
    expect(result.error?.retryable).toBe(true)
  })

  test('exposes the target paths a patch touches (used by the permission engine)', async () => {
    const { patchTargetPaths } = await import('./patch')
    const paths = patchTargetPaths(
      [
        '*** Begin Patch',
        '*** Add File: ../escape.txt',
        '*** Update File: src/app.ts',
        '*** End Patch',
      ].join('\n'),
    )
    expect(paths).toEqual(['../escape.txt', 'src/app.ts'])
  })

  test('parses a patch wrapped in a markdown code fence', async () => {
    const filePath = path.join(tempDir, 'fenced.ts')
    await writeFile(filePath, 'alpha\nbeta\ngamma\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-fence', {
      patch: [
        '```patch',
        '*** Begin Patch',
        '*** Update File: fenced.ts',
        '-beta',
        '+beta-changed',
        '*** End Patch',
        '```',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('alpha\nbeta-changed\ngamma\n')
  })

  test('recovers from an over-escaped body and writes correct (unescaped) output', async () => {
    const filePath = path.join(tempDir, 'escape.ts')
    await writeFile(filePath, 'const msg = "say \\"hi\\""\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    // Model double-escaped the quotes in the patch body (\\" where the file has \").
    const result = await tool.execute('tool-escape', {
      patch: [
        '*** Begin Patch',
        '*** Update File: escape.ts',
        '-const msg = "say \\\\"hi\\\\""',
        '+const msg = "say \\"bye\\""',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('const msg = "say \\"bye\\""\n')
  })

  test('accepts blank context lines emitted as empty strings (no leading space)', async () => {
    const filePath = path.join(tempDir, 'blank.ts')
    await writeFile(filePath, 'const a = 1\n\nconst b = 2\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    // The blank context line between the two statements is emitted as "" (the
    // model dropped the leading space) — must not reject the patch.
    const result = await tool.execute('tool-blank', {
      patch: [
        '*** Begin Patch',
        '*** Update File: blank.ts',
        ' const a = 1',
        '', // blank context line, no leading space
        '-const b = 2',
        '+const b = 3',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('const a = 1\n\nconst b = 3\n')
  })

  test('accepts context lines whose leading space the model dropped', async () => {
    const filePath = path.join(tempDir, 'noprefix.md')
    await writeFile(filePath, '# Title\n\n## Goal\n\nbuild it\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    // Context lines "## Goal" and the blank line are emitted without a leading
    // space — must be treated as context, not rejected.
    const result = await tool.execute('tool-noprefix', {
      patch: [
        '*** Begin Patch',
        '*** Update File: noprefix.md',
        '## Goal',
        '',
        '-build it',
        '+build it well',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('# Title\n\n## Goal\n\nbuild it well\n')
  })

  test('does NOT fuzzy-misapply onto a near-duplicate block elsewhere', async () => {
    // Two very similar blocks; the patch context matches neither exactly. A loose
    // fuzzy matcher would silently edit the wrong one. We require it to refuse.
    const filePath = path.join(tempDir, 'dup.ts')
    await writeFile(
      filePath,
      'function a() {\n  return computeValue(1)\n}\nfunction b() {\n  return computeValue(2)\n}\n',
      'utf8',
    )
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-dup', {
      patch: [
        '*** Begin Patch',
        '*** Update File: dup.ts',
        '-  return computeValue(9999)', // matches neither block closely enough
        '+  return computeValue(0)',
        '*** End Patch',
      ].join('\n'),
    })

    // Either refuses (retryable) — never silently edits the wrong block.
    expect(result.isError).toBe(true)
    expect(result.error?.retryable).toBe(true)
    expect(await readFile(filePath, 'utf8')).toBe(
      'function a() {\n  return computeValue(1)\n}\nfunction b() {\n  return computeValue(2)\n}\n',
    )
  })

  test('keeps CRLF line endings throughout an update', async () => {
    const filePath = path.join(tempDir, 'crlf.ts')
    await writeFile(filePath, 'alpha\r\nbeta\r\ngamma\r\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-crlf', {
      patch: [
        '*** Begin Patch',
        '*** Update File: crlf.ts',
        ' alpha',
        '-beta',
        '+beta-changed',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('alpha\r\nbeta-changed\r\ngamma\r\n')
  })

  test('preserves a UTF-8 BOM through an update', async () => {
    const filePath = path.join(tempDir, 'bom.ts')
    await writeFile(filePath, '﻿alpha\nbeta\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-bom', {
      patch: [
        '*** Begin Patch',
        '*** Update File: bom.ts',
        '-beta',
        '+beta-changed',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('﻿alpha\nbeta-changed\n')
  })

  test('appends a verify note when a non-exact strategy matched', async () => {
    const filePath = path.join(tempDir, 'note.ts')
    await writeFile(filePath, 'function f() {\n    return 1\n}\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    // 2-space content vs the file's 4-space indentation: matches via a tolerant
    // strategy, which must be surfaced as a note instead of a server-only warn.
    const result = await tool.execute('tool-note', {
      patch: [
        '*** Begin Patch',
        '*** Update File: note.ts',
        '-  return 1',
        '+  return 2',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('note:')
    expect(result.content).toContain('tolerance')
    expect(await readFile(filePath, 'utf8')).toBe('function f() {\n    return 2\n}\n')
  })

  test('refuses to patch a file that changed on disk since the last tool touch', async () => {
    const filePath = path.join(tempDir, 'stale.ts')
    await writeFile(filePath, 'const a = 1\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const first = await tool.execute('tool-stale-1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: stale.ts',
        '-const a = 1',
        '+const a = 2',
        '*** End Patch',
      ].join('\n'),
    })
    expect(first.isError).toBeUndefined()

    // Simulate an external change: bump the mtime past the recorded one.
    await utimes(filePath, new Date(), new Date(Date.now() + 5_000))

    const second = await tool.execute('tool-stale-2', {
      patch: [
        '*** Begin Patch',
        '*** Update File: stale.ts',
        '-const a = 2',
        '+const a = 3',
        '*** End Patch',
      ].join('\n'),
    })
    expect(second.isError).toBe(true)
    expect(second.error?.retryable).toBe(true)
    expect(second.content).toContain('changed on disk')
    expect(await readFile(filePath, 'utf8')).toBe('const a = 2\n')
  })

  test('keeps the good file when a later file fails to write — no cross-file rollback', async () => {
    const fileA = path.join(tempDir, 'a.txt')
    const fileB = path.join(tempDir, 'b.txt')
    await writeFile(fileA, 'aaa-original\n', 'utf8')
    await writeFile(fileB, 'bbb-original\n', 'utf8')

    // Environment that fails writing b.txt but otherwise delegates to local.
    const failingEnv: ExecutionEnvironment = {
      config: localEnvironment.config,
      readFile: (p) => localEnvironment.readFile(p),
      writeFile: async (p, c) => {
        if (p.endsWith('b.txt') && c.includes('bbb-changed')) throw new Error('disk full')
        return localEnvironment.writeFile(p, c)
      },
      exec: (cmd, opts) => localEnvironment.exec(cmd, opts),
      searchFiles: (pattern, cwd, glob) => localEnvironment.searchFiles(pattern, cwd, glob),
    }

    const tool = createPatchTool(failingEnv, tempDir)
    const result = await tool.execute('tool-partial-write', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.txt',
        '-aaa-original',
        '+aaa-changed',
        '*** Update File: b.txt',
        '-bbb-original',
        '+bbb-changed',
        '*** End Patch',
      ].join('\n'),
    })

    // a.txt applied → partial success, not a hard error.
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Applied 1 of 2 files')
    expect(result.content).toContain('b.txt')
    expect(result.content).toContain('disk full')
    expect(result.details).toMatchObject({ appliedFiles: 1, failedFiles: 1, totalFiles: 2 })
    // a.txt KEPT (no rollback); b.txt untouched (its write failed).
    expect(await readFile(fileA, 'utf8')).toBe('aaa-changed\n')
    expect(await readFile(fileB, 'utf8')).toBe('bbb-original\n')
  })

  test('applies the valid file and skips the one whose context does not match', async () => {
    const fileA = path.join(tempDir, 'a.txt')
    const fileB = path.join(tempDir, 'b.txt')
    await writeFile(fileA, 'keep me\n', 'utf8')
    await writeFile(fileB, 'real content\n', 'utf8')

    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-partial-validate', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.txt',
        '-keep me',
        '+kept and changed',
        '*** Update File: b.txt',
        '-this context does not exist in the file',
        '+whatever',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Applied 1 of 2 files')
    expect(result.details).toMatchObject({ appliedFiles: 1, failedFiles: 1 })
    expect(result.details?.failures?.[0]?.path).toBe('b.txt')
    // a.txt applied; b.txt left exactly as it was (bad context never written).
    expect(await readFile(fileA, 'utf8')).toBe('kept and changed\n')
    expect(await readFile(fileB, 'utf8')).toBe('real content\n')
  })

  test('all files fail → a single retryable error, nothing written', async () => {
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-all-fail', {
      patch: [
        '*** Begin Patch',
        '*** Update File: missing-1.txt',
        '-x',
        '+y',
        '*** Update File: missing-2.txt',
        '-x',
        '+y',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBe(true)
    expect(result.error?.retryable).toBe(true)
    expect(result.content).toContain('No files were applied')
    expect(result.details).toBeUndefined()
  })

  test('standalone "*** Move to: <old> -> <new>" performs a pure rename, content intact', async () => {
    const tool = createPatchTool(undefined, tempDir)
    await writeFile(path.join(tempDir, 'old.txt'), 'keep me\nsecond line\n')
    const result = await tool.execute('tool-move', {
      patch: ['*** Begin Patch', '*** Move to: old.txt -> renamed.txt', '*** End Patch'].join('\n'),
    })

    expect(result.isError).toBeFalsy()
    expect(await readFile(path.join(tempDir, 'renamed.txt'), 'utf8')).toBe('keep me\nsecond line\n')
    expect(readFile(path.join(tempDir, 'old.txt'), 'utf8')).rejects.toThrow()
  })

  test('a MOVE whose original cannot be deleted rolls the write back and blames the original (crumple zone)', async () => {
    await writeFile(path.join(tempDir, 'old.txt'), 'keep me\nsecond line\n')

    // Delegates to local, but the `rm -f` of the ORIGINAL path (old.txt) fails —
    // as it would on a read-only directory. The rollback's `rm -f` of the new path
    // (renamed.txt) must still succeed, so only the original's delete is broken.
    const failingEnv: ExecutionEnvironment = {
      config: localEnvironment.config,
      readFile: (p) => localEnvironment.readFile(p),
      writeFile: (p, c) => localEnvironment.writeFile(p, c),
      exec: (cmd, opts) => {
        if (cmd.includes('rm -f') && cmd.includes('old.txt')) {
          return Promise.resolve({ stdout: '', stderr: 'rm: Permission denied', exitCode: 1 })
        }
        return localEnvironment.exec(cmd, opts)
      },
      searchFiles: (pattern, cwd, glob) => localEnvironment.searchFiles(pattern, cwd, glob),
    }

    const tool = createPatchTool(failingEnv, tempDir)
    // Pair the failing move with a succeeding Add File so the tool reports partial
    // success WITH structured `details.failures` (an all-fail patch returns a
    // content-only retryable error instead).
    const result = await tool.execute('tool-move-delete-fail', {
      patch: [
        '*** Begin Patch',
        '*** Add File: sibling.txt',
        '+ok',
        '*** Move to: old.txt -> renamed.txt',
        '*** End Patch',
      ].join('\n'),
    })

    // Crumple zone: the new file was written then rolled back, so it must NOT linger
    // (else a retry dies on "move target already exists").
    expect(readFile(path.join(tempDir, 'renamed.txt'), 'utf8')).rejects.toThrow()
    // The original is untouched and fully recoverable.
    expect(await readFile(path.join(tempDir, 'old.txt'), 'utf8')).toBe('keep me\nsecond line\n')
    // The sibling add still applied — no cross-file rollback.
    expect(await readFile(path.join(tempDir, 'sibling.txt'), 'utf8')).toBe('ok\n')
    expect(result.details).toMatchObject({ appliedFiles: 1, failedFiles: 1 })
    // The failure is attributed to the path that actually failed (the original), not
    // to the move target as the generic Phase-2 catch would have reported.
    const failurePath = result.details?.failures?.[0]?.path ?? ''
    expect(failurePath).toContain('old.txt')
    expect(failurePath).not.toContain('renamed.txt')
    expect(result.details?.failures?.[0]?.reason).toContain('could not remove the original')
  })

  test('multiple concatenated Begin/End envelopes apply as one multi-file patch', async () => {
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-multi-env', {
      patch: [
        '*** Begin Patch',
        '*** Add File: one.txt',
        '+first',
        '*** End Patch',
        '*** Begin Patch',
        '*** Add File: two.txt',
        '+second',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeFalsy()
    expect(result.details?.appliedFiles).toBe(2)
    expect(await readFile(path.join(tempDir, 'one.txt'), 'utf8')).toBe('first\n')
    expect(await readFile(path.join(tempDir, 'two.txt'), 'utf8')).toBe('second\n')
  })

  test('writes three bare-content Add File sections in one envelope', async () => {
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('tool-bare-add', {
      patch: [
        '*** Begin Patch',
        '*** Add File: file1.txt',
        'This is the first test file.',
        'It contains several sentences.',
        '*** Add File: file2.txt',
        'second file body',
        '*** Add File: file3.txt',
        'third file body',
        '*** End Patch',
      ].join('\n'),
    })

    expect(result.isError).toBeFalsy()
    expect(result.details?.appliedFiles).toBe(3)
    expect(await readFile(path.join(tempDir, 'file1.txt'), 'utf8')).toBe(
      'This is the first test file.\nIt contains several sentences.\n',
    )
    expect(await readFile(path.join(tempDir, 'file2.txt'), 'utf8')).toBe('second file body\n')
    expect(await readFile(path.join(tempDir, 'file3.txt'), 'utf8')).toBe('third file body\n')
  })

  test('tolerates mirrored trailing asterisks on Begin/End and file headers', async () => {
    await writeFile(path.join(tempDir, 'app.css'), '.a { color: red; }\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)

    const result = await tool.execute('tool-mirror', {
      patch: [
        '*** Begin Patch ***',
        '*** Update File: app.css ***',
        '-.a { color: red; }',
        '+.a { color: blue; }',
        '*** End Patch ***',
      ].join('\n'),
    })

    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'app.css'), 'utf8')).toBe('.a { color: blue; }\n')
  })
})

import { closestLineHint, buildNotFoundHint } from './patch'

describe('closestLineHint / buildNotFoundHint', () => {
  test('multi-line pattern anchors on the best whole block, not a generic first line', () => {
    const lines = [
      'async (c) => {', // generic first line, wrong region
      '  return other()',
      '}',
      '',
      'async (c) => {', // intended region: best 3-line block overlap
      '  const x = c.req.valid("query")',
      '  return streamSSE(c)',
      '}',
    ]
    const pattern = ['async (c) => {', "  const x = c.req.valid('query')", '  return streamSSE(c)']
    expect(closestLineHint(lines, pattern)).toBe(5)
  })

  test('hint context scales with the pattern size', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`)
    const pattern = Array.from({ length: 12 }, (_, i) => `line-${20 + i}-MODIFIED`)
    const hint = buildNotFoundHint(lines, pattern)
    const shown = hint.match(/^\d+\t/gm) ?? []
    expect(shown.length).toBeGreaterThanOrEqual(12)
  })
})

describe('createPatchTool — post-edit region echo', () => {
  let tempDir = ''
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-echo-'))
  })
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('a successful update hands back the post-edit lines, so the next patch anchors on disk', async () => {
    await writeFile(path.join(tempDir, 'e.ts'), 'a\nb\nc\nd\ne\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('e1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: e.ts',
        '@@',
        ' b',
        '-c',
        '+C!',
        ' d',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('now reads')
    expect(result.content).toContain('3\tC!')
    expect(result.content).toContain('do not re-read it')
  })

  test('an Add File carries no echo — the model authored the whole content', async () => {
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('e2', {
      patch: ['*** Begin Patch', '*** Add File: fresh.ts', '+hi', '*** End Patch'].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).not.toContain('now reads')
  })
})

describe('createPatchTool — interior duplicated context', () => {
  let tempDir = ''
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-interior-'))
  })
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('two changes a line apart, with the shared context line written twice, still apply', async () => {
    // The most common malformation in the recorded corpus: change A's trailing
    // context repeated as change B's leading context.
    await writeFile(path.join(tempDir, 'i.ts'), 'a\nb\nc\nd\ne\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('i1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: i.ts',
        '@@',
        ' a',
        '-b',
        '+B',
        ' c',
        ' c',
        '-d',
        '+D',
        ' e',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'i.ts'), 'utf8')).toBe('a\nB\nc\nD\ne\n')
    expect(result.content).toContain('repaired a malformed hunk')
  })

  test('a genuinely repeated file line is not silently deduped', async () => {
    // "}" twice is real content, and the un-deduped block matches — the repair must
    // never fire, or the patch would drop a line the file really has.
    await writeFile(path.join(tempDir, 'j.ts'), 'x\n}\n}\ny\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('j1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: j.ts',
        '@@',
        ' x',
        ' }',
        ' }',
        '-y',
        '+Y',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'j.ts'), 'utf8')).toBe('x\n}\n}\nY\n')
  })

  test('an ambiguous interior dedup is refused, not guessed', async () => {
    await writeFile(path.join(tempDir, 'k.ts'), 'p\nq\np\nq\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('k1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: k.ts',
        '@@',
        ' zzz',
        ' zzz',
        '-nope',
        '+nah',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Failed to locate the context')
  })
})

describe('createPatchTool — the @@ anchor as the sole locator', () => {
  let tempDir = ''
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-anchor-'))
  })
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('a pure insertion whose anchor is missing fails loudly instead of landing at the top of the file', async () => {
    // The anchor is the only thing locating a "+"-only hunk. Falling through with a
    // stale position silently inserted the lines at line 1.
    const filePath = path.join(tempDir, 'a.ts')
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('a1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@ function nope()',
        '+INSERTED',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('anchor was not found')
    expect(await readFile(filePath, 'utf8')).toBe('one\ntwo\nthree\n')
  })

  test('a pure insertion whose anchor IS found lands right after it', async () => {
    const filePath = path.join(tempDir, 'b.ts')
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('b1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: b.ts',
        '@@ two',
        '+INSERTED',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('one\ntwo\nINSERTED\nthree\n')
  })

  test('a hunk WITH content survives a missing anchor — content matching still locates it', async () => {
    const filePath = path.join(tempDir, 'c.ts')
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('c1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: c.ts',
        '@@ function nope()',
        '-two',
        '+TWO',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('one\nTWO\nthree\n')
  })

  test('an anchor-less, context-less insertion is appended and says so', async () => {
    const filePath = path.join(tempDir, 'd.ts')
    await writeFile(filePath, 'one\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('d1', {
      patch: ['*** Begin Patch', '*** Update File: d.ts', '+APPENDED', '*** End Patch'].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('appended at the end of the file')
    expect(await readFile(filePath, 'utf8')).toBe('one\nAPPENDED\n')
  })

  test('a non-exact anchor match is reported so the model can verify', async () => {
    const filePath = path.join(tempDir, 'e.ts')
    await writeFile(filePath, 'function renderFooter(props) {\n  b\n}\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('e1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: e.ts',
        '@@   function renderFooter(props) {  ',
        '+  INSERTED',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('anchor matched with')
  })
})

describe('createPatchTool — hunks listed out of file order', () => {
  let tempDir = ''
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-order-'))
  })
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('a bottom-up patch applies, and says the hunk was out of order', async () => {
    // Chunks match positionally from the previous chunk's end, so a hunk listed after
    // one that sits LATER in the file used to fail with "context block not found" —
    // for a block that is in the file, just earlier. The model reads that as "the file
    // changed under me" and starts re-reading.
    const filePath = path.join(tempDir, 'a.ts')
    await writeFile(filePath, 'alpha\nbeta\ngamma\ndelta\nepsilon\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('o1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-delta',
        '+DELTA',
        '@@',
        '-beta',
        '+BETA',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('alpha\nBETA\ngamma\nDELTA\nepsilon\n')
    expect(result.content).toContain('out of file order')
  })

  test('an AMBIGUOUS earlier block is refused, not guessed', async () => {
    const filePath = path.join(tempDir, 'b.ts')
    await writeFile(filePath, 'dup\nmid\ndup\ntail\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('o2', {
      patch: [
        '*** Begin Patch',
        '*** Update File: b.ts',
        '@@',
        '-tail',
        '+TAIL',
        '@@',
        '-dup',
        '+DUP',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(await readFile(filePath, 'utf8')).toBe('dup\nmid\ndup\ntail\n')
  })

  test('an out-of-order hunk that would overlap an already-claimed region is refused', async () => {
    const filePath = path.join(tempDir, 'c.ts')
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    // The second hunk targets the very lines the first one already replaced.
    const result = await tool.execute('o3', {
      patch: [
        '*** Begin Patch',
        '*** Update File: c.ts',
        '@@',
        ' one',
        '-two',
        '+TWO',
        '@@',
        ' one',
        '-two',
        '+2',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(true)
    expect(await readFile(filePath, 'utf8')).toBe('one\ntwo\nthree\n')
  })
})

describe('createPatchTool — a patch that changes nothing says so', () => {
  let tempDir = ''
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-noop-'))
  })
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('identical "-" and "+" lines report "NOT changed", not a bare success', async () => {
    await writeFile(path.join(tempDir, 'a.ts'), 'x = 1\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('n1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-x = 1',
        '+x = 1',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBeUndefined() // re-applying an applied patch is idempotent, not a failure
    expect(result.content).toContain('was NOT changed')
  })

  test('a pure rename is not mislabelled as an unchanged file', async () => {
    await writeFile(path.join(tempDir, 'old.ts'), 'keep\n', 'utf8')
    const tool = createPatchTool(undefined, tempDir)
    const result = await tool.execute('n2', {
      patch: ['*** Begin Patch', '*** Move to: old.ts -> new.ts', '*** End Patch'].join('\n'),
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).not.toContain('was NOT changed')
    expect(await readFile(path.join(tempDir, 'new.ts'), 'utf8')).toBe('keep\n')
  })
})

describe('apply_patch classification', () => {
  test.each([
    ['an update', { patch: '*** Begin Patch\n*** Update File: a.ts\n@@\n-a\n+b\n*** End Patch' }],
    ['a delete', { patch: '*** Begin Patch\n*** Delete File: a.ts\n*** End Patch' }],
    ['unparseable input', 'not an object'],
  ])('%s reaches files', (_label, input) => {
    expect(createPatchTool(undefined, '/tmp').classify?.(input)).toEqual({ effect: 'files' })
  })
})
