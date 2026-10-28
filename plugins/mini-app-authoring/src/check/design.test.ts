import { describe, expect, test } from 'bun:test'

import { fakeKit } from '../testing/fake-kit'
import { tempDirPerTest, writeTree } from '../testing/temp'
import { checkMiniAppStyle } from './style'

const tempDir = tempDirPerTest('mini-app-design-')

/** A kit whose theme declares the tokens the screens below use. */
function kitWithTheme() {
  const dir = tempDir()
  writeTree(dir, { 'ui/styles/theme.css': ':root { --color-foreground: #000; }' })
  return fakeKit({
    dir,
    tools: {
      style: {
        rules: [],
        themeTokensOf: () => ({ colors: new Set(['foreground']), radii: new Set() }),
        missingTokens: () => [],
      },
    },
  })
}

async function problemsOf(screen: string): Promise<string[]> {
  const app = tempDir()
  writeTree(app, { 'ui/App.tsx': screen })
  return checkMiniAppStyle(app, kitWithTheme())
}

describe('the design rules a machine can see', () => {
  test('a screen of flat surfaces, words and kit icons passes', async () => {
    const screen = `export const App = () => (
  <section className="flex flex-col gap-6 rounded-lg border border-border">
    <h1 className="text-3xl font-semibold tabular-nums text-foreground">1 240</h1>
    <p className="text-xs text-text-faint">Goal reached © 2026</p>
    <div className="bg-linear-to-r from-background to-transparent" />
  </section>
)`
    expect(await problemsOf(screen)).toEqual([])
  })

  test.each([
    ['gradient text', '<h1 className="bg-gradient-to-r bg-clip-text text-transparent">Hi</h1>'],
    ['gradient', '<div className="bg-linear-to-br from-foreground">x</div>'],
    ['side stripe', '<div className="rounded-lg border-l-4 border-foreground">x</div>'],
    ['emoji icon', '<span>🍎 Apple</span>'],
    ['attention motion', '<span className="animate-ping">x</span>'],
    ['glow', '<div className="shadow-[0_0_24px_rgba(0,0,0,0.5)]">x</div>'],
  ])('%s is named with its line and the fix', async (rule, markup) => {
    const problems = await problemsOf(`export const App = () => (\n  ${markup}\n)`)

    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(`ui/App.tsx:2`)
    expect(problems.join('\n')).toContain(`— ${rule}:`)
  })
})
