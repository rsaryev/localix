import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { checkMiniAppBindings } from './binding-check'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function miniApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'binding-check-'))
  dirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

const REGISTER = `import { resourceMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
export function registerUi(host) {
  host.workItems.register({
    toMessageBinding: () => resourceMessageBindingDraft({ uri: TIMER_URI, label: 'Timer' }),
  })
}
`

// Regression: the copy deleted backend/context.ts and kept the binding, so every message sent
// with the tab open carried "no resource provider" instead of the timer.
test('a resource binding without a backend provider is reported at its line', async () => {
  const dir = miniApp({
    'ui/register.tsx': REGISTER,
    'backend/index.ts': '// a resourceProvider is mentioned only here\nexport const x = 1\n',
  })
  const problems = await checkMiniAppBindings(dir)
  expect(problems).toHaveLength(1)
  expect(problems[0]).toStartWith('ui/register.tsx:4 attaches a resource to messages')
})

test('a backend that registers a provider, or a view with no resource binding, passes', async () => {
  expect(
    await checkMiniAppBindings(
      miniApp({
        'ui/register.tsx': REGISTER,
        'backend/index.ts': 'export const reg = { resourceProvider: provider }\n',
      }),
    ),
  ).toEqual([])
  expect(
    await checkMiniAppBindings(miniApp({ 'ui/register.tsx': 'export const x = 1\n' })),
  ).toEqual([])
})
