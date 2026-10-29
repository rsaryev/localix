import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { sourceTree } from '@localixai/source-lint'

/**
 * A mini app's rendered surface is never the application.
 *
 * A contributed component is mini app code on the host's render path, and React gives an unhandled
 * render error to the NEAREST boundary. Without one at the contribution site that is the root
 * boundary, so a single mini app throwing replaces the entire workspace with an error screen. That
 * is not hypothetical: the comment at `editor-grid/ui/registry.tsx` records it happening live, from
 * a `localix://` URI built with an empty id. (The work-item site itself is
 * `editor-grid/ui/MiniAppWorkItemBody.tsx`, which also remounts the boundary on a mini app
 * rebuild.)
 *
 * Both known sites are wrapped today. This test is what keeps the next one from not being: the
 * convention is invisible at the moment somebody adds a third contribution point, and nothing else
 * in the repository would fail.
 */

const repoRoot = resolve(import.meta.dir, '..')
const ROOT = 'apps/ui/src'
const BOUNDARY = 'SurfaceErrorBoundary'

/**
 * How a contributed component is taken out of its registry entry. Both spellings appear:
 * `const Tab = chosen.Component` and `const Contributed = contributed.Component`.
 */
const CONTRIBUTED_COMPONENT = /\b(?:const|let)\s+([A-Z][A-Za-z0-9]*)\s*=\s*[\w.]*\.Component\b/u

/** Rendered as `<Tab …>` / `<Contributed …>` somewhere after the binding. */
function rendersElement(source: string, name: string): boolean {
  return new RegExp(`<${name}[\\s/>]`, 'u').test(source)
}

describe('contributed mini app surfaces render inside a boundary', () => {
  // `sourceTree` is the anti-void assertion: it throws rather than hand back an empty list, and the
  // witnesses below make it throw if either known contribution site is moved or renamed.
  const files = sourceTree({
    roots: [join(repoRoot, ROOT)],
    mustInclude: [
      'widgets/editor-grid/ui/MiniAppWorkItemBody.tsx',
      'widgets/editor-grid/ui/FileEditorPicker.tsx',
    ],
    minFiles: 200,
    label: 'the workspace UI sources',
  })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ path: relative(repoRoot, file), source: readFileSync(file, 'utf8') }))

  test('the known contribution sites are the ones this guard is written against', () => {
    const sites = files.filter(({ source }) => CONTRIBUTED_COMPONENT.test(source))
    expect(sites.map((site) => site.path).sort()).toEqual([
      // A named hole in a host surface, and the chain of hooks a mini app wraps an open file in.
      // Both render a registry entry's `Component`, which is what puts them on this list.
      'apps/ui/src/features/inspector/ui/FileEditorEnhancements.tsx',
      'apps/ui/src/widgets/editor-grid/ui/FileEditorPicker.tsx',
      'apps/ui/src/widgets/editor-grid/ui/MiniAppWorkItemBody.tsx',
      'apps/ui/src/widgets/editor-grid/ui/WorkItemSlot.tsx',
    ])
  })

  test('every site that renders a contributed component also mounts the boundary', () => {
    const unguarded: string[] = []
    for (const { path, source } of files) {
      const match = CONTRIBUTED_COMPONENT.exec(source)
      if (!match) continue
      const name = match[1] as string
      if (!rendersElement(source, name)) continue
      if (!source.includes(BOUNDARY)) unguarded.push(path)
    }
    expect(unguarded).toEqual([])
  })
})
