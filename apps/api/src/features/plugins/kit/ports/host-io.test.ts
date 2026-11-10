import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { hostLocations, processEnvironment, scratchFolder, systemClock } from './host-io'

const dir = tempDirPerTest('kit-host-io')

describe('the real clock', () => {
  test('tells the time and cancels a timer before it fires', async () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(1_000)
    let fired = false
    const cancel = systemClock.setTimer(() => (fired = true), 0)
    cancel()
    await systemClock.sleep(0)
    expect(fired).toBe(false)
  })

  test('a sleep ends with the reason of the signal that stopped it', async () => {
    const controller = new AbortController()
    const pending = systemClock.sleep(60_000, controller.signal)
    controller.abort(new Error('stopped'))
    await expect(pending).rejects.toThrow('stopped')
    await expect(systemClock.sleep(1, AbortSignal.abort(new Error('early')))).rejects.toThrow(
      'early',
    )
  })
})

describe('the environment', () => {
  test('gives the string variables of its source, read at each call', () => {
    let source: NodeJS.ProcessEnv = { A: '1', B: undefined }
    const environment = processEnvironment(() => source)
    expect(environment.snapshot()).toEqual({ A: '1' })
    source = { A: '2' }
    expect(environment.get('A')).toBe('2')
    expect(environment.get('B')).toBeUndefined()
  })
})

describe('where things are', () => {
  test('names home, the project and a plugin root as the host gives them', () => {
    const where = hostLocations({
      homeDir: '/h',
      projectDir: () => '/p',
      pluginRoot: (id) => `/r/${id}`,
    })
    expect([where.homeDir(), where.projectDir(), where.pluginRoot('x@m')]).toEqual([
      '/h',
      '/p',
      '/r/x@m',
    ])
    expect(where.joinPath('/base', 'a/b.md')).toBe(join('/base', 'a', 'b.md'))
  })

  test('creates the plugin data folder under the Localix home the first time it is asked', async () => {
    const where = hostLocations({
      homeDir: dir(),
      projectDir: () => dir(),
      pluginRoot: () => dir(),
    })
    const data = await where.pluginData('demo@market')
    expect(data).toBe(join(dir(), '.localix/plugin-data/demo-market'))
    expect(statSync(data).isDirectory()).toBe(true)
  })

  test('picks the first candidate that is a folder', async () => {
    writeTree(dir(), { 'file.txt': '', 'b/.keep': '' })
    const where = hostLocations({
      homeDir: dir(),
      projectDir: () => dir(),
      pluginRoot: () => dir(),
    })
    const candidates = [join(dir(), 'missing'), join(dir(), 'file.txt'), join(dir(), 'b')]
    expect(await where.existingDirectory(candidates)).toBe(join(dir(), 'b'))
    expect(await where.existingDirectory([join(dir(), 'missing')])).toBeUndefined()
  })
})

describe('the scratch folder', () => {
  test('writes each spill to its own file and gives its path', async () => {
    const scratch = scratchFolder(() => join(dir(), 'scratch'))
    const first = await scratch.write('hook output.txt', 'one')
    const second = await scratch.write('hook output.txt', 'two')
    expect(first).not.toBe(second)
    expect(readFileSync(first, 'utf8')).toBe('one')
    expect(first.endsWith('hook-output.txt')).toBe(true)
    expect(existsSync(second)).toBe(true)
  })
})
