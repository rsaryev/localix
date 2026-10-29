import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendDiagnostics,
  capDiff,
  createFileMtimeStore,
  detectLineEnding,
  invalidateFileMtime,
  normalizeToLF,
  resolveFileTarget,
  resolveTargetPath,
  restoreLineEndings,
  sameNameInCwdHint,
  staleFileMessage,
  stripBom,
  alignToCharBoundary,
  withPathLock,
  withPathLocks,
  workspaceLockPaths,
  MAX_DIFF_LINES,
} from './file-utils'

describe('alignToCharBoundary', () => {
  it('backs a mid-char cut up to the char start so toString never emits U+FFFD', () => {
    // "a✓" = 0x61 0xE2 0x9C 0x93 — cutting at 2 or 3 lands inside the 3-byte ✓.
    const buf = Buffer.from('a✓', 'utf8')
    expect(alignToCharBoundary(buf, 2)).toBe(1)
    expect(alignToCharBoundary(buf, 3)).toBe(1)
    expect(buf.subarray(0, alignToCharBoundary(buf, 3)).toString('utf8')).toBe('a')
    expect(buf.subarray(0, alignToCharBoundary(buf, 3)).toString('utf8')).not.toContain('�')
  })

  it('leaves a clean boundary untouched and clamps past the end', () => {
    const buf = Buffer.from('a✓', 'utf8')
    expect(alignToCharBoundary(buf, 1)).toBe(1) // 'a' boundary
    expect(alignToCharBoundary(buf, 4)).toBe(4) // exact end
    expect(alignToCharBoundary(buf, 99)).toBe(4) // clamp
    expect(alignToCharBoundary(buf, 0)).toBe(0)
  })
})

describe('line endings + BOM', () => {
  it('detects the dominant ending by which appears first', () => {
    expect(detectLineEnding('a\r\nb')).toBe('\r\n')
    expect(detectLineEnding('a\nb\r\nc')).toBe('\n') // lone \n precedes the \r\n
    expect(detectLineEnding('no newline')).toBe('\n')
    expect(detectLineEnding('a\nb')).toBe('\n')
  })

  it('normalizes CRLF/CR to LF and restores round-trip', () => {
    expect(normalizeToLF('a\r\nb\rc')).toBe('a\nb\nc')
    expect(restoreLineEndings('a\nb', '\r\n')).toBe('a\r\nb')
    expect(restoreLineEndings('a\nb', '\n')).toBe('a\nb')
    const orig = 'a\r\nb\r\nc'
    expect(restoreLineEndings(normalizeToLF(orig), '\r\n')).toBe(orig)
  })

  it('strips and reports a leading BOM', () => {
    const bom = String.fromCharCode(0xfeff)
    expect(stripBom(`${bom}hello`)).toEqual({ bom, text: 'hello' })
    expect(stripBom('hello')).toEqual({ bom: '', text: 'hello' })
  })
})

describe('capDiff', () => {
  it('returns the diff unchanged at or below the line cap', () => {
    const small = Array.from({ length: 10 }, (_, i) => `+ line ${i}`).join('\n')
    expect(capDiff(small)).toBe(small)
    expect(capDiff(undefined)).toBeUndefined()
  })

  it('elides the middle of an oversized diff, keeping head + tail', () => {
    const lines = Array.from({ length: MAX_DIFF_LINES + 100 }, (_, i) => `line${i}`)
    const out = capDiff(lines.join('\n'))!.split('\n')
    expect(out.length).toBe(MAX_DIFF_LINES + 1) // head + marker + tail
    expect(out[0]).toBe('line0')
    expect(out.some((l) => l.includes('more diff lines elided'))).toBe(true)
    expect(out[out.length - 1]).toBe(`line${lines.length - 1}`)
  })
})

describe('resolveFileTarget', () => {
  it('keeps an absolute path and ignores cwd for it', () => {
    const r = resolveFileTarget('/abs/file.ts', undefined, '/base')
    expect(r.path).toBe('/abs/file.ts')
  })

  it('resolves a relative path against cwd, and a relative cwd against defaultCwd', () => {
    expect(resolveFileTarget('a.ts', undefined, '/base').path).toBe('/base/a.ts')
    expect(resolveFileTarget('a.ts', 'sub', '/base')).toEqual({
      cwd: '/base/sub',
      path: '/base/sub/a.ts',
    })
  })
})

describe('resolveTargetPath', () => {
  it('returns an absolute filePath unchanged', () => {
    expect(resolveTargetPath('/abs/x.ts', 'sub', '/base')).toBe('/abs/x.ts')
  })
  it('resolves a relative path against cwd, and a relative cwd against defaultCwd', () => {
    expect(resolveTargetPath('a.ts', undefined, '/base')).toBe('/base/a.ts')
    expect(resolveTargetPath('a.ts', 'sub', '/base')).toBe('/base/sub/a.ts')
  })
  it('honors an absolute cwd', () => {
    expect(resolveTargetPath('a.ts', '/other', '/base')).toBe('/other/a.ts')
  })
})

describe('appendDiagnostics', () => {
  it('passes content through when there is no block', () => {
    expect(appendDiagnostics('result', undefined)).toBe('result')
    expect(appendDiagnostics('result', '')).toBe('result')
  })
  it('wraps a block in the lsp_diagnostics envelope', () => {
    expect(appendDiagnostics('result', 'ERR')).toBe(
      'result\n\n<lsp_diagnostics>\nERR\n</lsp_diagnostics>',
    )
  })
})

describe('stale-mtime tracking', () => {
  it('records, detects staleness, and clears', () => {
    const p = join('/tmp', `stale-${Math.random().toString(36).slice(2)}.txt`)
    const store = createFileMtimeStore()
    expect(store.has(p)).toBe(false)
    expect(store.isStale(p, 123)).toBe(false) // no record → not stale
    store.record(p, 123)
    expect(store.has(p)).toBe(true)
    expect(store.isStale(p, 123)).toBe(false) // unchanged
    expect(store.isStale(p, 999)).toBe(true) // changed on disk
    store.clear(p)
    expect(store.has(p)).toBe(false)
    store.dispose()
  })

  it('two sessions do not share records — one session reading never unlocks another', () => {
    // A single process-wide map used to let session A's `read` satisfy session B's
    // blind-overwrite guard, and let B's `write` re-record an mtime that A's stale
    // check then accepted over content A had never seen.
    const p = join('/tmp', `iso-${Math.random().toString(36).slice(2)}.txt`)
    const a = createFileMtimeStore()
    const b = createFileMtimeStore()
    a.record(p, 123)
    expect(b.has(p)).toBe(false)
    b.record(p, 999)
    expect(a.isStale(p, 123)).toBe(false) // A still judges against what A saw
    a.dispose()
    b.dispose()
  })

  it('invalidateFileMtime forgets the path in every live store, and skips disposed ones', () => {
    // The user saving in the editor: no agent tool saw the new content, so every
    // session must re-read before it may overwrite.
    const p = join('/tmp', `inv-${Math.random().toString(36).slice(2)}.txt`)
    const a = createFileMtimeStore()
    const b = createFileMtimeStore()
    const gone = createFileMtimeStore()
    a.record(p, 1)
    b.record(p, 2)
    gone.record(p, 3)
    gone.dispose()
    invalidateFileMtime(p)
    expect(a.has(p)).toBe(false)
    expect(b.has(p)).toBe(false)
    a.dispose()
    b.dispose()
  })

  it('staleFileMessage names the path, the likely user edit, and tells the model to re-read', () => {
    const msg = staleFileMessage('src/a.ts')
    expect(msg).toContain('src/a.ts')
    expect(msg).toContain('your own shell command')
    expect(msg).toContain('Re-read')
  })

  it('wasInvalidated distinguishes a user edit from a never-read file', () => {
    // Both end with `has() === false`, but they need opposite advice: "the user
    // may have edited it" vs "you never read it". Only invalidation sets the flag.
    const p = join('/tmp', `winv-${Math.random().toString(36).slice(2)}.txt`)
    const store = createFileMtimeStore()
    expect(store.wasInvalidated(p)).toBe(false) // never seen → no claim
    store.record(p, 1)
    invalidateFileMtime(p)
    expect(store.has(p)).toBe(false)
    expect(store.wasInvalidated(p)).toBe(true) // user edit after our read
    store.record(p, 2) // re-read: the session has seen the new content
    expect(store.wasInvalidated(p)).toBe(false)
    expect(store.has(p)).toBe(true)
    store.dispose()
  })

  it('invalidateFileMtime never flags a store that held no record for the path', () => {
    const p = join('/tmp', `wnorec-${Math.random().toString(36).slice(2)}.txt`)
    const store = createFileMtimeStore()
    invalidateFileMtime(p)
    expect(store.wasInvalidated(p)).toBe(false)
    store.dispose()
  })

  it('clear() drops the invalidation flag along with the record', () => {
    const p = join('/tmp', `wclr-${Math.random().toString(36).slice(2)}.txt`)
    const store = createFileMtimeStore()
    store.record(p, 1)
    invalidateFileMtime(p)
    store.clear(p) // e.g. the tool deleted the file — the flag is meaningless now
    expect(store.wasInvalidated(p)).toBe(false)
    store.dispose()
  })
})

describe('sameNameInCwdHint', () => {
  // Fake env: `present` = paths readFile resolves for; `rgFiles` = cwd-relative
  // paths `rg --files` lists. exec parses the `--glob '**/<base>'` we build and
  // returns matching basenames (respecting the head cap is unnecessary for tests).
  function fakeEnv(present: string[], rgFiles: string[] = []) {
    return {
      readFile: async (p: string) => {
        if (present.includes(p)) return 'ok'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      exec: async (command: string) => {
        const m = command.match(/--glob '\*\*\/(.+?)'/)
        const wantBase = m ? m[1].replace(/\\(.)/g, '$1') : ''
        // `rg --files -0`: every path is NUL-terminated.
        const stdout = rgFiles
          .filter((rel) => rel.split('/').pop() === wantBase)
          .map((rel) => `${rel}\0`)
          .join('')
        return { stdout, exitCode: 0 }
      },
    }
  }

  it('Case 1: suggests the same basename directly in cwd (the "/"-prefixed guess)', async () => {
    const env = fakeEnv(['/work/maze.html'])
    const hint = await sameNameInCwdHint(env, '/maze.html', '/work')
    expect(hint).toBe('\nDid you mean: /work/maze.html? (use that exact path)')
  })

  it('Case 2: recovers a wrong-DIRECTORY guess via the workspace suffix match', async () => {
    // Guessed utils/foo.ts; it lives at src/utils/foo.ts. Not in cwd → rg search.
    const env = fakeEnv([], ['src/utils/foo.ts', 'other/foo.ts'])
    const hint = await sameNameInCwdHint(env, '/work/utils/foo.ts', '/work')
    expect(hint).toBe('\nDid you mean: /work/src/utils/foo.ts? (use that exact path)')
  })

  it('a single same-basename candidate is unambiguous even without a dir match', async () => {
    const env = fakeEnv([], ['deep/nested/only.ts'])
    const hint = await sameNameInCwdHint(env, '/work/only.ts', '/work')
    expect(hint).toBe('\nDid you mean: /work/deep/nested/only.ts? (use that exact path)')
  })

  it('stays silent when several candidates tie with no directory to disambiguate', async () => {
    const env = fakeEnv([], ['a/index.ts', 'b/index.ts', 'c/index.ts'])
    // requested "index.ts" shares only the basename with each → tie at score 1.
    expect(await sameNameInCwdHint(env, '/work/index.ts', '/work')).toBe('')
  })

  it('returns "" when nothing plausible exists anywhere', async () => {
    const env = fakeEnv([], ['unrelated.ts'])
    expect(await sameNameInCwdHint(env, '/work/missing.ts', '/work')).toBe('')
  })

  it('is best-effort: an exec failure degrades to no hint', async () => {
    const env = {
      readFile: async () => {
        throw new Error('ENOENT')
      },
      exec: async () => {
        throw new Error('rg not found')
      },
    }
    expect(await sameNameInCwdHint(env, '/work/x.ts', '/work')).toBe('')
  })

  it('never suggests the exact path the model already tried', async () => {
    // rg lists the very path requested (relative form) — must not echo it back.
    const env = fakeEnv([], ['foo.ts'])
    expect(await sameNameInCwdHint(env, '/work/foo.ts', '/work')).toBe('')
  })

  // A REAL shell, because the defect lives in the shell's parse: the model-supplied
  // basename used to be spliced between bare single quotes, so `x'$(touch PWNED)'`
  // closed the quote and ran `touch` — whether or not rg is even installed.
  function shellEnv() {
    return {
      readFile: async () => {
        throw new Error('ENOENT')
      },
      exec: async (command: string, opts?: { cwd?: string }) => {
        const res = Bun.spawnSync(['sh', '-c', command], { cwd: opts?.cwd, timeout: 10_000 })
        return { stdout: res.stdout.toString(), exitCode: res.exitCode ?? 1 }
      },
    }
  }

  it('a quote in the requested name cannot execute a command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'same-name-inject-'))
    try {
      await sameNameInCwdHint(shellEnv(), `${dir}/x'$(touch PWNED)'`, dir)
      await sameNameInCwdHint(shellEnv(), `${dir}/x';touch PWNED2;'`, dir)
      expect(existsSync(join(dir, 'PWNED'))).toBe(false)
      expect(existsSync(join(dir, 'PWNED2'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!Bun.which('rg'))(
    'finds a name with edge whitespace via the NUL-split listing',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'same-name-nul-'))
      try {
        mkdirSync(join(dir, 'src'))
        writeFileSync(join(dir, 'src', ' spaced.ts '), '')
        const hint = await sameNameInCwdHint(shellEnv(), `${dir}/lib/ spaced.ts `, dir)
        expect(hint).toBe(`\nDid you mean: ${dir}/src/ spaced.ts ? (use that exact path)`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('path locks', () => {
  it('serializes same-path critical sections in acquisition order', async () => {
    const order: number[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const p1 = withPathLock('/x', async () => {
      await gate
      order.push(1)
    })
    const p2 = withPathLock('/x', async () => {
      order.push(2)
    })
    await new Promise((r) => setTimeout(r, 0)) // p2 has had its turn and still waits
    release()
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2]) // p2 waited for the slower p1
  })

  it('lets different paths run concurrently', async () => {
    const order: number[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const a = withPathLock('/a', async () => {
      await gate
      order.push(1)
    })
    const b = withPathLock('/b', async () => {
      order.push(2)
      release()
    })
    await Promise.all([a, b])
    expect(order).toEqual([2, 1]) // b did not wait for the slower a
  })

  it('withPathLocks acquires multiple paths and returns the result', async () => {
    const result = await withPathLocks(['/p2', '/p1', '/p1'], async () => 'done')
    expect(result).toBe('done')
  })

  it('workspaceLockPaths owns every namespace below the root, but not the root itself', () => {
    expect(workspaceLockPaths('/work', ['/work/src/deep/a.ts']).sort()).toEqual(
      ['/work/src/deep/a.ts', '/work/src/deep', '/work/src'].sort(),
    )
  })

  it('keeps top-level siblings parallel and bounds an outside target at its parent', () => {
    expect(workspaceLockPaths('/work', ['/work/a.ts', '/work/b.ts']).sort()).toEqual(
      ['/work/a.ts', '/work/b.ts'].sort(),
    )
    expect(workspaceLockPaths('/work', ['/outside/deep/a.ts']).sort()).toEqual(
      ['/outside/deep/a.ts', '/outside/deep'].sort(),
    )
  })

  it('locks the root itself only when it is the explicit mutation target', () => {
    expect(workspaceLockPaths('/work', ['/work'])).toEqual(['/work'])
  })
})
