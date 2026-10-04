import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('a bare probe-entry import survives package tree-shaking', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'localix-vf-side-effect-'))
  try {
    const packageRoot = join(fixture, 'node_modules', '@localixai', 'visual-feedback')
    mkdirSync(packageRoot, { recursive: true })
    cpSync(import.meta.dir, join(packageRoot, 'src'), { recursive: true })
    const sourceManifest = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'),
    ) as { sideEffects: string[] }
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@localixai/visual-feedback',
        type: 'module',
        sideEffects: sourceManifest.sideEffects,
        exports: { './probe-entry': './src/probe/entry.ts' },
      }),
    )
    const entry = join(fixture, 'entry.js')
    const outdir = join(fixture, 'out')
    writeFileSync(entry, "import '@localixai/visual-feedback/probe-entry'\n")
    const result = await Bun.build({
      entrypoints: [entry],
      outdir,
      target: 'browser',
      minify: true,
      external: ['modern-screenshot'],
    })
    expect(result.success).toBe(true)
    expect(readFileSync(join(outdir, 'entry.js'), 'utf8')).toContain('__vf_probe_mounted')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
