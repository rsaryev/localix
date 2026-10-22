/**
 * A session's hooks between runs: the hooks its latest run assembled fire there, a watched file's
 * change fires FileChanged with what happened to it, and hook-named paths join the watch list.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { CcHookRegistry } from '../../cc-hooks'
import { createCcHookSessions, type WatchFile } from './cc-hook-sessions'

const dir = tempDirPerTest('cc-sessions-')

/** A watcher the test drives: `touch(path)` reports a change to the file at `path`. */
function fakeWatcher() {
  const watched = new Map<string, () => void>()
  const watch: WatchFile = (path, onChange) => {
    watched.set(path, onChange)
    return () => watched.delete(path)
  }
  return { watch, watched, touch: (path: string) => watched.get(path)?.() }
}

/** A FileChanged hook that appends its input as one line to `log` and may name more paths. */
const fileChanged = (matcher: string | undefined, then = 'exit 0'): CcHookRegistry => ({
  FileChanged: [
    {
      matcher,
      handlers: [
        {
          source: 'plugin',
          // One append per hook: two hooks running at once must not interleave their lines.
          command: `line=$(cat); printf '%s\\n' "$line" >> "${join(dir(), 'log')}"; ${then}`,
          timeoutMs: 5000,
        },
      ],
    },
  ],
})

// The hooks are real shell processes; each wait below has its own deadline, every test this one.
setDefaultTimeout(30_000)

/** Until the hook's line lands: bounded by a deadline, checked each tick, never a guessed sleep. */
async function logged(lines: number, deadlineMs = 10_000): Promise<string[]> {
  const until = Date.now() + deadlineMs
  for (;;) {
    let text = ''
    try {
      text = await Bun.file(join(dir(), 'log')).text()
    } catch {}
    const got = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; file_path: string })
      .map((input) => `${input.event} ${input.file_path}`)
    if (got.length >= lines || Date.now() > until) return got
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('between-run hooks', () => {
  test('a session that has not run fires nothing', () => {
    expect(createCcHookSessions().runtimeFor('s1').active).toBe(false)
  })

  test("the matcher's filenames are watched in the working directory; each change fires", async () => {
    const w = fakeWatcher()
    const sessions = createCcHookSessions(w.watch)
    sessions.remember('s1', { registry: fileChanged('.envrc|.env'), projectDir: dir() })
    const envrc = join(dir(), '.envrc')
    expect([...w.watched.keys()].sort()).toEqual([join(dir(), '.env'), envrc])

    writeFileSync(envrc, 'export A=1')
    w.touch(envrc)
    expect(await logged(1)).toEqual([`add ${envrc}`])
    w.touch(envrc)
    expect(await logged(2)).toEqual([`add ${envrc}`, `change ${envrc}`])
    rmSync(envrc)
    w.touch(envrc)
    expect(await logged(3)).toContain(`unlink ${envrc}`)
  })

  test("a hook's watchPaths replace the dynamic list; forgetting the session stops watching", async () => {
    const w = fakeWatcher()
    const sessions = createCcHookSessions(w.watch)
    const extra = join(dir(), 'extra.json')
    sessions.remember('s1', {
      registry: fileChanged(undefined, `echo '{"watchPaths":["${extra}"]}'`),
      projectDir: dir(),
    })
    expect(w.watched.size).toBe(0)
    sessions.setWatchPaths('s1', [join(dir(), 'seed')])
    w.touch(join(dir(), 'seed'))
    await logged(1)
    for (const until = Date.now() + 10_000; Date.now() < until && !w.watched.has(extra);)
      await new Promise((r) => setTimeout(r, 5))
    expect([...w.watched.keys()]).toEqual([extra])
    sessions.forget('s1')
    expect(w.watched.size).toBe(0)
  })

  test('context a between-run hook left is taken once, the last one winning', () => {
    const sessions = createCcHookSessions()
    sessions.setPendingContext('s1', 'first')
    sessions.setPendingContext('s1', 'on opus')
    expect(sessions.takeContext('s1')).toBe('on opus')
    expect(sessions.takeContext('s1')).toBeUndefined()
  })
})
