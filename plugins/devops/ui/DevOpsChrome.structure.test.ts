import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const devopsRoot = resolve(import.meta.dir, '..')
const read = (path: string) => readFileSync(resolve(devopsRoot, path), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path)
    return path.endsWith('.tsx') && !path.includes('.test.') ? [path] : []
  })
}

/** The sparkline is a plotted trace, not chrome, so it owns its own drawing height. */
const NOT_CHROME = new Set(['StatsSparkline.tsx'])

const uiSources = sourceFiles(devopsRoot)
  .filter((path) => !NOT_CHROME.has(basename(path)))
  .map((path) => ({ path, source: readFileSync(path, 'utf8') }))

describe('DevOps workbench geometry', () => {
  test('keeps every resource tab header on one seam', () => {
    for (const path of [
      'docker/ui/ui/DockerResourceHeader.tsx',
      'docker/ui/ui/DockerContainerHeader.tsx',
      'kubernetes/ui/ui/KubernetesNodeHeader.tsx',
      'kubernetes/ui/ui/KubernetesResourceHeader.tsx',
      'kubernetes/ui/ui/PodTabHeader.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('border-b border-border-soft px-3 py-2')
      expect(source).not.toContain('px-4 py-3')
    }
  })

  test('keeps the two workbench sidebars on one control-row seam', () => {
    for (const path of [
      'kubernetes/ui/ui/SidebarControls.tsx',
      'docker/ui/ui/DockerSidebarHeader.tsx',
    ]) {
      expect(read(path)).toContain('<WorkbenchFilterBar')
    }
  })

  test('sizes chrome from the geometry scale instead of ad-hoc heights', () => {
    for (const { path, source } of uiSources) {
      expect(`${path}: ${source}`).not.toMatch(/\b(?:min-)?h-(?:7|8|9|10)\b/)
      expect(`${path}: ${source}`).not.toMatch(/\b(?:min-)?h-\[\d+px\]/)
    }
  })

  test('lets resource detail grids span their pane instead of capping data', () => {
    for (const path of [
      'docker/ui/ui/DockerResourceContent.tsx',
      'kubernetes/ui/ui/KubernetesNodeOverview.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('border-y border-border-soft')
      expect(source).not.toContain('max-w-')
      expect(source).not.toContain('mx-auto')
    }
  })

  test('takes toolbar padding from the primitive density, never a local override', () => {
    for (const { path, source } of uiSources) {
      const override = source.match(/<WorkbenchToolbar[^>]*className="[^"]*\bpx-[\d.]+/s)?.[0] ?? ''
      expect(`${path}: ${override}`).toBe(`${path}: `)
    }
  })

  test('renders every failure through the host problem line, and nothing else', () => {
    expect(read('ui/DevOpsProblem.tsx')).toContain('ProblemLine')
    for (const { path, source } of uiSources) {
      if (path === 'ui/DevOpsProblem.tsx') continue
      expect(
        `${path}: ${/DevOpsIssue|applyError|loadIssue/.test(source) && /WorkbenchNoticeBar[\s\S]*tone="(error|warning)"/.test(source)}`,
      ).toBe(`${path}: false`)
    }
  })
})
