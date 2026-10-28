/**
 * One model router per models folder, however many API processes use it — with real processes.
 *
 * Each "API" is `testing/fake-api.ts`: the orphan guard (watchdog included) and a model router
 * over a shared folder, driven over IPC. The router executable is the fake llama-server behind a
 * shell `exec`, so the process the claim names is the one serving, as with the real binary.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { tempDirPerTest } from '@localixai/testing'
import { isAlive, killProcessTreeNow } from '../../lib/process-tree'

const posix = process.platform !== 'win32'
const dir = tempDirPerTest('router-shared')
const HOST = join(import.meta.dir, 'testing', 'fake-api.ts')
const FAKE = join(import.meta.dir, 'testing', 'fake-llama-server.ts')
const cleanup: Array<() => void> = []

afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo()
})

interface Reply {
  id?: number
  ready?: number
  pid?: number
  url?: string
  status?: number
  error?: string
}

/** A models folder, the run dir the hosts' orphan guards share, and the router executable. */
function machine(name = 'machine') {
  const base = join(dir(), name)
  const root = join(base, 'models')
  mkdirSync(root, { recursive: true })
  const executable = join(base, 'llama-server')
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\n`,
  )
  chmodSync(executable, 0o755)
  const presets = join(root, 'router', 'presets.ini')
  cleanup.push(() => {
    for (const pid of routersOf(presets)) killProcessTreeNow(pid)
  })
  return { root, executable, runDir: join(base, 'run'), presets }
}

/** Live router processes started over `presets` (the marker their command line carries). */
function routersOf(presets: string): number[] {
  const out = Bun.spawnSync(['ps', '-axo', 'pid=,command=']).stdout.toString()
  return out
    .split('\n')
    .filter((line) => line.includes(presets) && line.includes('fake-llama-server'))
    .map((line) => Number.parseInt(line.trim(), 10))
}

async function startApi(m: ReturnType<typeof machine>) {
  const waiting = new Map<number, (reply: Reply) => void>()
  let ready!: (pid: number) => void
  const started = new Promise<number>((resolve) => (ready = resolve))
  const proc: Subprocess = Bun.spawn([process.execPath, HOST, m.root, m.executable, m.runDir], {
    stdio: ['ignore', 'inherit', 'inherit'],
    ipc(message: Reply) {
      if (message.ready) ready(message.ready)
      else if (message.id !== undefined) waiting.get(message.id)?.(message)
    },
  })
  cleanup.push(() => proc.kill('SIGKILL'))
  let next = 0
  const call = (op: 'ensure' | 'stop' | 'reapStale') =>
    new Promise<Reply>((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => reject(new Error(`${op} got no answer`)), 20_000)
      waiting.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      proc.send({ id, op })
    })
  await Promise.race([
    started,
    Bun.sleep(10_000).then(() => {
      throw new Error('the API host never came up')
    }),
  ])
  return { proc, call }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (check()) return true
    await Bun.sleep(50)
  }
  return check()
}

describe.skipIf(!posix)('one model router per models folder (real processes)', () => {
  test('a second API uses the router the first one started', async () => {
    const m = machine()
    const a = await startApi(m)
    const b = await startApi(m)
    const first = await a.call('ensure')
    const second = await b.call('ensure')
    expect(first.status).toBe(200)
    expect(second).toMatchObject({ pid: first.pid, url: first.url, status: 200 })
    expect(routersOf(m.presets)).toEqual([first.pid!])
  }, 30_000)

  test('two APIs asking at the same moment start one router', async () => {
    const m = machine()
    const [a, b] = await Promise.all([startApi(m), startApi(m)])
    const [x, y] = await Promise.all([a.call('ensure'), b.call('ensure')])
    expect(x.status).toBe(200)
    expect(y).toMatchObject({ pid: x.pid, status: 200 })
    expect(routersOf(m.presets)).toEqual([x.pid!])
  }, 30_000)

  test('when the owning API is killed, its router goes and the other API starts its own', async () => {
    const m = machine()
    const owner = await startApi(m)
    const borrower = await startApi(m)
    const shared = await owner.call('ensure')
    await borrower.call('ensure')

    owner.proc.kill('SIGKILL')
    expect(await until(() => !isAlive(shared.pid!), 6_000)).toBe(true)

    const own = await borrower.call('ensure')
    expect(own.status).toBe(200)
    expect(own.pid).not.toBe(shared.pid)
    expect(routersOf(m.presets)).toEqual([own.pid!])
  }, 30_000)

  test('when the owning API quits, the other API starts its own on its next request', async () => {
    const m = machine()
    const owner = await startApi(m)
    const borrower = await startApi(m)
    const shared = await owner.call('ensure')
    await borrower.call('ensure')

    await owner.call('stop')
    owner.proc.kill('SIGTERM')
    expect(isAlive(shared.pid!)).toBe(false)

    const own = await borrower.call('ensure')
    expect(own).toMatchObject({ status: 200 })
    expect(routersOf(m.presets)).toEqual([own.pid!])
  }, 30_000)

  test('an API that borrowed the router leaves it running when it quits or is killed', async () => {
    const m = machine()
    const owner = await startApi(m)
    const shared = await owner.call('ensure')
    const quitting = await startApi(m)
    await quitting.call('ensure')
    await quitting.call('stop')
    const killed = await startApi(m)
    await killed.call('ensure')
    killed.proc.kill('SIGKILL')
    await killed.proc.exited

    expect(await owner.call('ensure')).toMatchObject({ pid: shared.pid, status: 200 })
    expect(routersOf(m.presets)).toEqual([shared.pid!])
  }, 30_000)

  test('separate models folders keep separate routers', async () => {
    const one = machine('one')
    const two = machine('two')
    const a = await (await startApi(one)).call('ensure')
    const b = await (await startApi(two)).call('ensure')
    expect(a.pid).not.toBe(b.pid)
    expect(routersOf(one.presets)).toEqual([a.pid!])
    expect(routersOf(two.presets)).toEqual([b.pid!])
  }, 30_000)

  test('a router left by an API that is gone is reaped at boot; a stranger under its pid is not', async () => {
    const m = machine()
    mkdirSync(join(m.root, 'router'), { recursive: true })
    // A router whose API and watchdog both died: alive, serving, owned by nobody.
    const stray = Bun.spawn([m.executable, '--models-preset', m.presets, '--port', '0'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    cleanup.push(() => killProcessTreeNow(stray.pid))
    const stranger = Bun.spawn(['sleep', '300'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    cleanup.push(() => killProcessTreeNow(stranger.pid))
    const gone = Bun.spawnSync(['true']).pid
    const claim = (routerPid: number) =>
      writeFileSync(
        join(m.root, 'router', 'router.json'),
        JSON.stringify({ routerPid, ownerPid: gone, baseUrl: 'http://127.0.0.1:9', apiKey: 'k' }),
      )

    claim(stranger.pid)
    const api = await startApi(m)
    await api.call('reapStale')
    expect(isAlive(stranger.pid)).toBe(true)

    claim(stray.pid)
    await api.call('reapStale')
    expect(await until(() => !isAlive(stray.pid), 5_000)).toBe(true)
    const own = await api.call('ensure')
    expect(routersOf(m.presets)).toEqual([own.pid!])
  }, 30_000)
})
