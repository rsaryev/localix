import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fakeKit } from '../testing/fake-kit'
import { tempDirPerTest, writeTree } from '../testing/temp'
import { assemblePackage, PACKAGE_DIR } from './assemble'
import { CATALOG_FILE, packIntoCatalog } from './pack'
import { validatePackage } from './validate'

const tempDir = tempDirPerTest('mini-app-package-')

const MANIFEST = {
  name: 'gpu-monitor',
  version: '0.2.0',
  description: 'Watch the GPU.',
  backend: './backend/index.ts',
  icon: './icon.svg',
  guide: './guide.md',
  screenshots: [{ path: './media/main.png', caption: 'The board' }],
}

/** A source folder after a passing check: the candidate holds the built backend and UI. */
function checkedApp() {
  const dir = tempDir()
  writeTree(dir, {
    'mini-app.json': JSON.stringify(MANIFEST),
    'guide.md': '# Guide',
    'icon.svg': '<svg/>',
    'media/main.png': 'png',
    'README.md': '# GPU Monitor',
    'backend/index.ts': 'export {}',
    'backend/index.test.ts': 'test',
    'ui/Workspace.tsx': 'export {}',
    'AGENTS.md': 'for the agent',
    'package.json': '{}',
    '.env': 'SECRET=1',
    'node_modules/zod/index.js': '',
    'dist/.candidate-1/dist/backend/index-abc.mjs': 'export {}',
    'dist/.candidate-1/dist/ui/artifact.json': '{}',
  })
  const outputs = {
    dir: join(dir, 'dist/.candidate-1'),
    manifest: MANIFEST,
    backend: './dist/backend/index-abc.mjs',
    hasUi: true,
  }
  return { dir, outputs }
}

const files = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(root, join(dir, entry.name))
      : [join(dir, entry.name).slice(root.length + 1)],
  )

describe('assemblePackage', () => {
  test('carries the built code and what the app reads, and leaves sources and secrets behind', async () => {
    const { dir, outputs } = checkedApp()
    const packageDir = await assemblePackage(dir, outputs)
    expect(packageDir).toBe(join(dir, PACKAGE_DIR))
    expect(files(packageDir).sort()).toEqual([
      'README.md',
      'dist/backend/index-abc.mjs',
      'dist/ui/artifact.json',
      'guide.md',
      'icon.svg',
      'media/main.png',
      'mini-app.json',
    ])
    const manifest = JSON.parse(readFileSync(join(packageDir, 'mini-app.json'), 'utf8'))
    expect(manifest.backend).toBe('./dist/backend/index-abc.mjs')
  })

  test('authoring names are left behind at the package root only, not inside shipped folders', async () => {
    const { dir, outputs } = checkedApp()
    writeTree(dir, {
      'assets/preview/shot.txt': 'shipped',
      'data/package.json': '{"shipped":true}',
      'preview/draft.txt': 'authoring',
    })
    const packageDir = await assemblePackage(dir, outputs)
    expect(files(packageDir)).toContain('assets/preview/shot.txt')
    expect(files(packageDir)).toContain('data/package.json')
    expect(files(packageDir)).not.toContain('preview/draft.txt')
    expect(files(packageDir)).not.toContain('package.json')
  })

  test('a second build replaces the first package whole', async () => {
    const { dir, outputs } = checkedApp()
    await assemblePackage(dir, outputs)
    writeTree(join(dir, PACKAGE_DIR), { 'stale.txt': 'old' })
    await assemblePackage(dir, outputs)
    expect(existsSync(join(dir, PACKAGE_DIR, 'stale.txt'))).toBe(false)
  })
})

describe('validatePackage', () => {
  test('a built package is valid', async () => {
    const { dir, outputs } = checkedApp()
    const verdict = await validatePackage(fakeKit(), await assemblePackage(dir, outputs))
    expect(verdict).toEqual({ ok: true, name: 'gpu-monitor', problems: [], warnings: [] })
  })

  test('a source folder is not a package, and a named file must be there', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': JSON.stringify(MANIFEST), 'icon.svg': '<svg/>' })
    const verdict = await validatePackage(fakeKit(), dir)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join('\n')).toContain('backend ./backend/index.ts is a source file')
    expect(verdict.problems.join('\n')).toContain(
      './guide.md is named in mini-app.json but missing',
    )
  })

  test('the SDK schema’s problems and the media rules come from the kit', async () => {
    const { dir, outputs } = checkedApp()
    const kit = fakeKit({
      tools: {
        manifest: {
          ...fakeKit().tools.manifest,
          validate: async () => ({
            name: 'gpu-monitor',
            errors: ['Invalid mini-app.json: version: invalid'],
            warnings: [],
          }),
          checkMedia: async () => ['icon.svg is not a square'],
        },
      },
    })
    const verdict = await validatePackage(kit, await assemblePackage(dir, outputs))
    expect(verdict.problems).toEqual(['Invalid mini-app.json: version: invalid'])
    expect(verdict.warnings).toEqual(['icon.svg is not a square'])
  })
})

describe('packIntoCatalog', () => {
  test('publishes the archive and the store media beside a catalog that names them', async () => {
    const { dir, outputs } = checkedApp()
    const packageDir = await assemblePackage(dir, outputs)
    const outDir = tempDir()
    const entry = await packIntoCatalog({ kit: fakeKit(), packageDir, outDir, publisher: 'Ada' })
    const catalog = JSON.parse(readFileSync(join(outDir, CATALOG_FILE), 'utf8'))
    expect(catalog.apps).toEqual([entry])
    expect(entry.publisher).toEqual({ name: 'Ada', verified: false })
    expect(entry.icon).toMatchObject({ type: 'image/svg+xml' })
    for (const file of [entry.archive, entry.icon, ...(entry.screenshots as [])] as {
      url: string
    }[]) {
      expect(existsSync(join(outDir, file.url))).toBe(true)
    }

    const archive = new Bun.Archive(readFileSync(join(outDir, entry.archive.url)))
    const inside = [...(await archive.files()).keys()]
    expect(inside).toContain('mini-app.json')
    expect(inside).not.toContain('media/main.png')
  })

  test('the packed archive validates although the screenshots are published beside it', async () => {
    const { dir, outputs } = checkedApp()
    const packageDir = await assemblePackage(dir, outputs)
    const outDir = tempDir()
    const entry = await packIntoCatalog({ kit: fakeKit(), packageDir, outDir, publisher: 'Ada' })
    const verdict = await validatePackage(fakeKit(), join(outDir, entry.archive.url))
    expect(verdict).toEqual({ ok: true, name: 'gpu-monitor', problems: [], warnings: [] })
  })

  test('packing another version replaces the app in the same catalog', async () => {
    const { dir, outputs } = checkedApp()
    const packageDir = await assemblePackage(dir, outputs)
    const outDir = tempDir()
    await packIntoCatalog({ kit: fakeKit(), packageDir, outDir, publisher: 'Ada' })
    writeTree(packageDir, {
      'mini-app.json': JSON.stringify({ ...MANIFEST, version: '0.3.0' }),
    })
    await packIntoCatalog({ kit: fakeKit(), packageDir, outDir, publisher: 'Ada' })
    const catalog = JSON.parse(readFileSync(join(outDir, CATALOG_FILE), 'utf8'))
    expect(catalog.apps.map((app: { version: string }) => app.version)).toEqual(['0.3.0'])
  })

  test('an app without a valid icon is refused', async () => {
    const packageDir = tempDir()
    mkdirSync(packageDir, { recursive: true })
    writeTree(packageDir, { 'mini-app.json': JSON.stringify({ ...MANIFEST, icon: undefined }) })
    const kit = fakeKit({
      tools: {
        manifest: { ...fakeKit().tools.manifest, checkMedia: async () => ['icon is required'] },
      },
    })
    await expect(
      packIntoCatalog({ kit, packageDir, outDir: tempDir(), publisher: 'Ada' }),
    ).rejects.toThrow('icon is required')
  })
})
