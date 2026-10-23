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
  test('sizes chrome from the geometry scale instead of ad-hoc heights', () => {
    for (const { path, source } of uiSources) {
      expect(`${path}: ${source}`).not.toMatch(/\b(?:min-)?h-(?:7|8|9|10)\b/)
      expect(`${path}: ${source}`).not.toMatch(/\b(?:min-)?h-\[\d+px\]/)
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
