import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readDocumentFontsFrom } from './fonts'

let outDir = ''

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'localix-pdf-bundle-'))
})

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true })
})

describe('packaged PDF generator', () => {
  test('is relocatable, carries no second copy of the fonts and reads the app’s own', async () => {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, 'pdf.ts')],
      outdir: outDir,
      target: 'bun',
      format: 'esm',
      splitting: true,
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.logs.map(String).join('\n'))

    const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..', '..')
    for (const output of result.outputs) {
      if (!/\.(?:js|mjs)$/.test(output.path)) continue
      expect(await readFile(output.path, 'utf8')).not.toContain(repoRoot)
    }

    // The fonts ship once, in the app's `assets/fonts`; the bundle copied all of them again.
    expect(result.outputs.filter((output) => output.path.endsWith('.ttf'))).toEqual([])
    readDocumentFontsFrom(resolve(import.meta.dir, '..', '..', '..'))

    const entry = result.outputs.find((output) => dirname(output.path) === outDir)?.path
    if (!entry) throw new Error('Bun produced no PDF generator entry bundle')
    const bundled = (await import(`${pathToFileURL(entry).href}?test=${Date.now()}`)) as {
      blocksToPdf(
        blocks: Array<{ type: 'paragraph'; spans: Array<{ text: string }> }>,
      ): Promise<Uint8Array>
    }
    const bytes = await bundled.blocksToPdf([
      { type: 'paragraph', spans: [{ text: 'Portable PDF' }] },
    ])
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  })
})
