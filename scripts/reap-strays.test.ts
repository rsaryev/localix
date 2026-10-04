import { describe, expect, test } from 'bun:test'
// @ts-expect-error — a plain .mjs script, imported for its pure selectors
import { elapsedSeconds, parsePs, selectStrays } from './reap-strays.mjs'

const repoRoot = '/Users/me/localix'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ps = (lines: string[]) => parsePs(lines.join('\n'))
const rules = (rows: ReturnType<typeof ps>) =>
  selectStrays(rows, { repoRoot }).map((s: { pid: number; rule: string }) => [s.pid, s.rule])

describe('reap-strays: what counts as left behind', () => {
  test('ps elapsed time parses in every form ps prints', () => {
    expect(elapsedSeconds('05')).toBe(5)
    expect(elapsedSeconds('08:47')).toBe(527)
    expect(elapsedSeconds('01:04:51')).toBe(3891)
    expect(elapsedSeconds('2-00:00:01')).toBe(172_801)
  })

  test('a bun test is stray only past the deadline, however it was launched', () => {
    const rows = ps([
      ` 10  5 25:00 bun test scripts/plugin-ui-artifact.test.ts`,
      ` 11  5 03:00 bun test apps/ui/src`,
      ` 12  5 30:00 /Users/me/.bun/bin/bun x test`,
    ])
    expect(rules(rows)).toEqual([
      [10, 'stuck bun test'],
      [12, 'stuck bun test'],
    ])
  })

  test('only a HEADLESS Chrome on a scratch profile, never the user’s own browser or its helpers', () => {
    const rows = ps([
      ` 20 1 58:07 ${CHROME} --headless=new --remote-debugging-port=9444 --user-data-dir=/private/tmp/claude-501/x/chrome-live`,
      ` 21 1 58:07 ${CHROME} --user-data-dir=/Users/me/Library/Chrome`,
      ` 22 20 58:07 /Applications/Google Chrome.app/Contents/Frameworks/X/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --headless --user-data-dir=/private/tmp/claude-501/x`,
      ` 23 1 05:00 ${CHROME} --headless --user-data-dir=/private/tmp/claude-501/y`,
    ])
    expect(rules(rows)).toEqual([[20, 'abandoned headless browser']])
  })

  test('an orphaned repo dev tool is stray; the parented dev server never is', () => {
    const rows = ps([
      ` 30 1 12:00 node ${repoRoot}/node_modules/.bin/vite --port 5077 --strictPort`,
      ` 31 91003 70:00 bun --watch src/index.ts`,
      ` 32 1 70:00 node /Users/me/other-project/node_modules/.bin/vite`,
      ` 33 1 02:00 node ${repoRoot}/node_modules/.bin/vite`,
    ])
    expect(rules(rows)).toEqual([[30, 'orphaned dev process']])
  })

  test('its own process and its parents are never selected', () => {
    const rows = ps([` 40 1 40:00 bun test scripts/reap-strays.test.ts`])
    expect(selectStrays(rows, { repoRoot, exclude: new Set([40]) })).toEqual([])
  })
})
