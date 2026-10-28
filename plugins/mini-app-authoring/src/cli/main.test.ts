import { describe, expect, test } from 'bun:test'

import { fakeKit } from '../testing/fake-kit'
import { tempDirPerTest, writeTree } from '../testing/temp'
import type { CliContext } from './commands'
import { runCli } from './main'

const tempDir = tempDirPerTest('mini-app-cli-')

function cli(cwd = tempDir()) {
  const lines: string[] = []
  const context: CliContext = {
    cwd,
    out: (text) => lines.push(text),
    kit: async () => ({ kit: fakeKit(), source: { dir: '/kit', from: 'named' } }),
  }
  return { context, output: () => lines.join('\n') }
}

describe('mini-app', () => {
  test('with no command, prints what it can do', async () => {
    const { context, output } = cli()
    expect(await runCli([], context)).toBe(0)
    expect(output()).toContain('mini-app create <name>')
  })

  test('an unknown command is a usage error', async () => {
    const { context, output } = cli()
    expect(await runCli(['publish-everything'], context)).toBe(2)
    expect(output()).toContain('Unknown command "publish-everything"')
  })

  test('a folder that is not a mini app is said plainly, without a stack', async () => {
    const { context, output } = cli()
    expect(await runCli(['check'], context)).toBe(1)
    expect(output()).toMatch(/is not a mini app: it has no readable mini-app\.json\.$/u)
  })

  test('validate judges a package folder and fails on its problems', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': '{"name":"gpu-monitor","backend":"./backend/index.ts"}' })
    const { context, output } = cli(dir)
    expect(await runCli(['validate', '.'], context)).toBe(1)
    expect(output()).toContain('backend ./backend/index.ts is a source file')
  })

  test('pack asks who publishes the app before building anything', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': '{"name":"gpu-monitor"}' })
    const { context, output } = cli(dir)
    expect(await runCli(['pack'], context)).toBe(1)
    expect(output()).toContain('--publisher')
  })

  test('kit names where the kit came from', async () => {
    const { context, output } = cli()
    expect(await runCli(['kit'], context)).toBe(0)
    expect(output()).toContain('Kit: /kit (from named)')
  })
})
