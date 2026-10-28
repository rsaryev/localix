import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'

import { createShellCommandService } from './service'

const tmpHome = join(tmpdir(), `localix-shellcmd-${randomUUID()}`)

const svc = (over?: Partial<Parameters<typeof createShellCommandService>[0]>) =>
  createShellCommandService({
    platform: 'linux',
    home: tmpHome,
    cliEntry: '/app/bin/localix.mjs',
    bunPath: '/usr/bin/bun',
    pathEnv: '/usr/bin',
    ...over,
  })

describe('shell-command service (posix)', () => {
  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true })
  })

  test('install → status installed, launcher is executable + forwards args', async () => {
    const service = svc()
    const pre = await service.status()
    expect(pre.state).toBe('not-installed')
    expect(pre.onPath).toBe(false)

    const installed = await service.install()
    expect(installed.state).toBe('installed')

    const target = join(tmpHome, '.local', 'bin', 'localix')
    const contents = await readFile(target, 'utf8')
    expect(contents).toContain('/usr/bin/bun')
    expect(contents).toContain('/app/bin/localix.mjs')
    const mode = (await stat(target)).mode & 0o777
    expect(mode & 0o100).toBe(0o100) // owner-executable

    expect((await service.status()).state).toBe('installed')

    const replacement = svc({ cliEntry: '/app/bin/localix-next.mjs' })
    expect((await replacement.status()).state).toBe('stale')
    await replacement.install()
    expect(await readFile(target, 'utf8')).toContain('/app/bin/localix-next.mjs')
  })

  test('a launcher pointing at a different CLI entry reads as stale', async () => {
    const stale = svc({ cliEntry: '/OLD/localix.mjs' })
    expect((await stale.status()).state).toBe('stale')
  })

  test('uninstall removes the launcher', async () => {
    const service = svc()
    await service.install()
    const after = await service.uninstall()
    expect(after.state).toBe('not-installed')
    expect(stat(join(tmpHome, '.local', 'bin', 'localix'))).rejects.toThrow()
  })

  test('onPath true when the bin dir is already on PATH', async () => {
    const service = svc({ pathEnv: `/usr/bin:${join(tmpHome, '.local', 'bin')}` })
    expect((await service.status()).onPath).toBe(true)
  })

  test('unavailable runtime reports not-installed and refuses install', async () => {
    const service = svc({ available: false })
    expect((await service.status()).available).toBe(false)
    expect(service.install()).rejects.toThrow()
  })
})
