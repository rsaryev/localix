import { EventEmitter } from 'node:events'
import type { spawn as nodeSpawn } from 'node:child_process'
import { describe, expect, test } from 'bun:test'
import { performHandoff } from './perform'

class FakeChild extends EventEmitter {
  stderr = new EventEmitter()
  unrefs = 0
  unref() {
    this.unrefs += 1
  }
}

function fakeSpawn(drive: (child: FakeChild) => void) {
  const calls: { cmd: string; args: string[] }[] = []
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    const child = new FakeChild()
    queueMicrotask(() => drive(child))
    return child
  }) as unknown as typeof nodeSpawn
  return { spawn, calls }
}

describe('performHandoff', () => {
  test('an opener that exits 0 succeeds, and the ATTEMPT is logged, not only failures', async () => {
    const lines: string[] = []
    const { spawn, calls } = fakeSpawn((child) => child.emit('exit', 0))
    const result = await performHandoff(
      { kind: 'url', url: 'https://localix.ai' },
      { platform: 'darwin', spawn, log: (line) => lines.push(line) },
    )
    expect(result).toEqual({ ok: true })
    expect(calls[0]).toEqual({ cmd: 'open', args: ['https://localix.ai'] })
    // An empty log must not mean both "never called" and "called and ignored".
    expect(lines).toEqual(['os-open url → https://localix.ai'])
  })

  test("the opener's stderr becomes the reason a person can act on", async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stderr.emit('data', 'Unable to find application named "Nope"\n')
      child.emit('exit', 1)
    })
    const result = await performHandoff(
      { kind: 'app', path: '/t/a.csv', app: 'Nope' },
      { platform: 'darwin', spawn },
    )
    expect(result).toEqual({ ok: false, reason: 'Unable to find application named "Nope"' })
  })

  test('a nonzero exit with no stderr still says something', async () => {
    const { spawn } = fakeSpawn((child) => child.emit('exit', 3))
    const result = await performHandoff(
      { kind: 'path', path: '/t/a.csv' },
      { platform: 'linux', spawn },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'The system opener refused this target (exit 3).',
    })
  })

  test("rundll32's exit status is not the handler's, so any exit counts as opened", async () => {
    const { spawn } = fakeSpawn((child) => child.emit('exit', 1))
    const result = await performHandoff(
      { kind: 'path', path: 'C:\\t\\a.csv' },
      { platform: 'win32', spawn },
    )
    expect(result).toEqual({ ok: true })
  })

  test('a missing binary is reported, not swallowed', async () => {
    const { spawn } = fakeSpawn((child) => child.emit('error', new Error('spawn open ENOENT')))
    const result = await performHandoff(
      { kind: 'url', url: 'https://localix.ai' },
      { platform: 'darwin', spawn },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'The system opener could not be started: spawn open ENOENT',
    })
  })

  test('an application is answered on spawn and detached, never waited on', async () => {
    const children: FakeChild[] = []
    const { spawn } = fakeSpawn((child) => {
      children.push(child)
      child.emit('spawn')
    })
    const result = await performHandoff(
      { kind: 'app', path: '/t/a.csv', app: 'libreoffice' },
      { platform: 'linux', spawn },
    )
    expect(result).toEqual({ ok: true })
    expect(children[0]!.unrefs).toBe(1)
  })

  test('an opener that never answers stops the caller waiting', async () => {
    const { spawn } = fakeSpawn(() => {})
    const result = await performHandoff(
      { kind: 'url', url: 'https://localix.ai' },
      { platform: 'darwin', spawn, timeoutMs: 5 },
    )
    expect(result).toEqual({ ok: false, reason: 'The system opener did not answer.' })
  })

  test('a flag-shaped target never reaches an option parser', async () => {
    const { spawn, calls } = fakeSpawn((child) => child.emit('exit', 0))
    const result = await performHandoff(
      { kind: 'path', path: '-R /etc/passwd' },
      { platform: 'darwin', spawn },
    )
    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
  })

  test('an empty target is refused rather than spawned', async () => {
    const { spawn, calls } = fakeSpawn((child) => child.emit('exit', 0))
    const result = await performHandoff({ kind: 'path', path: '   ' }, { platform: 'linux', spawn })
    expect(result).toEqual({ ok: false, reason: 'There is nothing to open.' })
    expect(calls).toEqual([])
  })
})
