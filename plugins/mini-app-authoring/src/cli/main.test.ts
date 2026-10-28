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

  test('ci sets the app up to be released from GitHub, built with its Localix', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': '{"name":"meal-log","displayName":"Meal Log"}' })
    const { context, output } = cli(dir)
    const kit = fakeKit()
    kit.manifest.localixVersion = '0.1.0-beta.18'
    context.kit = async () => ({ kit, source: { dir: '/kit', from: 'named' } })

    expect(await runCli(['ci'], context)).toBe(1)
    expect(output()).toContain('--publisher')

    expect(await runCli(['ci', '--publisher', 'rsaryev'], context)).toBe(0)
    const workflow = await Bun.file(`${dir}/.github/workflows/mini-app.yml`).text()
    expect(workflow).toContain('LOCALIX_REF: v0.1.0-beta.18')
    expect(await Bun.file(`${dir}/mini-app.json`).json()).toMatchObject({ author: 'rsaryev' })
    expect(await Bun.file(`${dir}/.gitignore`).text()).toContain('tsconfig.json')
    expect(output()).toContain('git tag v')

    // Named again, the publisher replaces the one kept, such as an app's copied "Localix".
    expect(await runCli(['ci', '--publisher', 'Ada'], context)).toBe(0)
    expect(await Bun.file(`${dir}/mini-app.json`).json()).toMatchObject({ author: 'Ada' })
  })

  test('kit names where the kit came from', async () => {
    const { context, output } = cli()
    expect(await runCli(['kit'], context)).toBe(0)
    expect(output()).toContain('Kit: /kit (from named)')
  })

  // Skills inject it with a shell command, so it must answer where no kit can be found.
  test('contract prints the app layer without resolving a kit', async () => {
    const { context, output } = cli()
    context.kit = async () => {
      throw new Error('no kit here')
    }
    expect(await runCli(['contract'], context)).toBe(0)
    expect(output()).toContain('defineCollection(')
  })

  // A plugin newer than the person's Localix would print a contract its kit cannot build.
  test('create refuses a kit older than the app layer, and says how to update', async () => {
    const { context, output } = cli()
    expect(await runCli(['create', 'meal-log'], context)).toBe(1)
    expect(output()).toContain('mini-app get-localix')
  })
})
