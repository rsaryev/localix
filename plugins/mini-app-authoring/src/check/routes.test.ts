import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { fakeKit } from '../testing/fake-kit'
import { checkMiniAppRoutes } from './routes'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A mini app folder holding exactly `files`. */
function miniApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'route-check-'))
  dirs.push(dir)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

describe('a user mini app route reads its body through a validator', () => {
  test('a raw parse is reported with its line and the fix', async () => {
    const dir = miniApp({
      'backend/routes.ts': [
        "import { Hono } from 'hono'",
        "export const routes = new Hono().post('/move', async (context) => {",
        '  const input = await context.req.json()',
        '  return context.json(input)',
        '})',
      ].join('\n'),
    })

    const problems = await checkMiniAppRoutes(dir, fakeKit())

    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith('backend/routes.ts:3 context.req.json(')
    expect(problems[0]).toContain('jsonBody(schema)')
  })

  test('jsonBody, a response helper, a comment and a test are not offenders', async () => {
    const dir = miniApp({
      'backend/routes.ts': [
        "import { jsonBody } from '@localixai/mini-app-sdk/backend'",
        '// Never c.req.json() here: see jsonBody.',
        "export const move = [jsonBody(schema), (c) => c.json(c.req.valid('json'))]",
      ].join('\n'),
      'backend/routes.test.ts': 'const probe = await c.req.json()',
    })

    expect(await checkMiniAppRoutes(dir, fakeKit())).toEqual([])
  })

  test('a mini app without a backend has nothing to check', async () => {
    expect(
      await checkMiniAppRoutes(miniApp({ 'ui/register.tsx': 'export {}' }), fakeKit()),
    ).toEqual([])
  })
})
