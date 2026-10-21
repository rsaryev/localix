import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Repo-wide guard for the ONE geometry scale.
 *
 * `packages/kit/styles/chrome.css` defines every persistent-chrome measure as a token
 * (`--chrome-control-xs…touch`, `--panel-header-height`, `--editor-tab-height`,
 * `--statusbar-height`, `--workbench-rail-width`, `--sash-hit-area`). A chrome row
 * written as a raw pixel height instead — `h-[43px]`, `min-h-[40px]` — is invisible
 * to that scale: it cannot be retuned with the theme and it silently stops lining up
 * with the row above it. `workbench-foundations.test.ts` pins the primitives; this
 * pins everything downstream of them, across the app AND every plugin, so the drift
 * cannot come back one panel at a time.
 *
 * Scope is deliberately narrow: only ARBITRARY PIXEL heights. Tailwind's own scale
 * (`h-8`) is legible and maps onto the tokens; rem measures are content sizing, not
 * chrome; `size-[17px]` is an icon, which is a typography question this guard does
 * not answer.
 */

const repoRoot = resolve(import.meta.dir, '..')
/** The kit is where the primitives live; a root left out here is a tree the guard never reads. */
const ROOTS = ['apps/ui/src', 'packages/kit/src', 'plugins']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage', '__snapshots__'])

/**
 * Arbitrary PIXEL heights: `h-[43px]`, `min-h-[40px]`.
 *
 * `size-[17px]` is deliberately NOT matched. Those are glyphs, and glyphs are a
 * typography question this guard does not answer. That question is now settled
 * elsewhere: the `--icon-*` token scale that ran parallel to Tailwind's
 * `size-3.5` ladder was converted to its exact `size-*` equivalents and
 * deleted, leaving one icon ladder. `workbench-foundations.test.ts` keeps it
 * that way.
 */
const PIXEL_HEIGHT = /\b(?:min-)?h-\[(\d+(?:\.\d+)?)px\]/g

/**
 * Measurements that are NOT chrome, each with the reason it is exempt. A new entry
 * needs a reason of the same kind — "it looked fine" is not one.
 */
// The database diagram's table card was the one entry; it now takes its row heights from the
// layout constants dagre places it by, so the measurement has a single owner and no exemption.
const EXEMPT: ReadonlyArray<{ file: string; why: string }> = []

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

describe('ui geometry scale', () => {
  test('no chrome row is sized with an arbitrary pixel height', () => {
    const exempt = new Set(EXEMPT.map((entry) => entry.file))
    const offenders: string[] = []

    for (const root of ROOTS) {
      for (const file of walk(resolve(repoRoot, root))) {
        const repoPath = relative(repoRoot, file)
        if (exempt.has(repoPath)) continue
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(PIXEL_HEIGHT)) {
          const line = source.slice(0, match.index).split('\n').length
          offenders.push(`${repoPath}:${line} ${match[0]}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  test('the chat measure is only ever spelled as its token', () => {
    /**
     * The transcript column, the composer beneath it and the read-only transcript TAB must be
     * the same width — the composer sits directly under the column, so a mismatch reads as a
     * misaligned box, and the tab is a separate surface meant to look identical. That width
     * was the literal `max-w-[58rem]` in six places across those two surfaces, guarded by
     * nothing: the geometry tests near them deliberately refuse to pin styling, so nothing
     * noticed if one copy moved.
     *
     * It is `--chat-measure` now, and these files own every row that uses it, so a hard-coded
     * max-width appearing in one of them is the drift coming back. Narrow on purpose: a
     * `max-w-[14rem]` elsewhere is a label truncation, which is content sizing and none of
     * this guard's business.
     *
     * A browser lane could instead assert the rendered widths are EQUAL — the only way to
     * check a layout claim, since the DOM used in tests has no layout engine and measures
     * everything as zero. The drift this actually guards against is textual, so it is caught
     * here without a browser, a download, or a dev-server fixture.
     */
    const MEASURE_SURFACES = [
      'apps/ui/src/widgets/chat-workspace/ui/ChatSurface.tsx',
      'apps/ui/src/entities/chat/ui/TranscriptView.tsx',
      'apps/ui/src/entities/chat/ui/TranscriptTab.tsx',
    ]
    const offenders: string[] = []
    for (const repoPath of MEASURE_SURFACES) {
      const source = readFileSync(resolve(repoRoot, repoPath), 'utf8')
      // The token must actually be in use, or this file stopped being a measure surface and
      // the list above is stale.
      expect(source).toContain('max-w-(--chat-measure)')
      for (const match of source.matchAll(/\bmax-w-\[[^\]]+\]/gu)) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${repoPath}:${line} ${match[0]} — use max-w-(--chat-measure)`)
      }
    }

    expect(offenders).toEqual([])
  })

  test('every exemption still points at a real file', () => {
    for (const entry of EXEMPT) {
      expect(() => statSync(resolve(repoRoot, entry.file))).not.toThrow()
      expect(entry.why.length).toBeGreaterThan(40)
    }
  })
})
