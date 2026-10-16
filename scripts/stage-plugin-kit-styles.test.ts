import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { stageHostStylesheets } from './stage-plugin-kit-styles.mjs'

const root = mkdtempSync(join(tmpdir(), 'stage-kit-styles-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * A workspace with a host stylesheet that imports a PACKAGE stylesheet made of layers — the shape
 * the kit's design system has (`@localixai/kit/styles.css` → `./theme.css`, `./base.css`).
 */
function fixture(): { entry: string; out: string } {
  const dir = mkdtempSync(join(root, 'ws-'))
  write(
    join(dir, 'node_modules/@acme/kit/package.json'),
    JSON.stringify({ name: '@acme/kit', exports: { './styles.css': './styles/index.css' } }),
  )
  write(
    join(dir, 'node_modules/@acme/kit/styles/index.css'),
    "@import './theme.css';\n@import './base.css';\n",
  )
  write(join(dir, 'node_modules/@acme/kit/styles/theme.css'), ':root { --x: 1; }\n')
  write(join(dir, 'node_modules/@acme/kit/styles/base.css'), 'body { color: red; }\n')
  const entry = join(dir, 'app/index.css')
  write(entry, "@import '@acme/kit/styles.css';\n@source '../../packages/kit/src';\n.app {}\n")
  return { entry, out: join(dir, 'kit-styles') }
}

describe('host stylesheet staging', () => {
  test('a package stylesheet keeps its own relative imports, never an import of itself', () => {
    const { entry, out } = fixture()
    stageHostStylesheets({ entry, outDir: out })
    const index = readFileSync(join(out, '@acme/kit/styles/index.css'), 'utf8')
    // The defect: both lines became `@import './index.css'`, and Tailwind recursed forever.
    expect(index).toContain("@import './theme.css'")
    expect(index).toContain("@import './base.css'")
    expect(index).not.toContain('index.css')
    expect(readFileSync(join(out, '@acme/kit/styles/theme.css'), 'utf8')).toContain('--x: 1')
  })

  test("the host's @source is dropped: its path means nothing inside the kit", () => {
    const { entry, out } = fixture()
    const staged = stageHostStylesheets({ entry, outDir: out })
    const host = readFileSync(join(out, staged), 'utf8')
    expect(host).not.toContain('@source')
    expect(host).toContain('.app {}')
    expect(host).toContain("@import '../@acme/kit/styles/index.css'")
  })
})
