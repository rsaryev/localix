import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { parseSync } from 'oxc-parser'
import { codeOnly } from '../../packages/source-lint/src/code'

/**
 * Shared reading kit for the architecture rule checks (`docs/internals/architecture/README.md`).
 *
 * A detector is a pure function from sources to stable violation keys (no line numbers, so a key
 * survives unrelated edits). The repository run compares those keys with a committed baseline in
 * `scripts/architecture-baselines/<rule>.json`: a new key fails with the rule id and its fix, and
 * a baseline key that no longer occurs fails as stale, so the list can only shrink.
 */

export const repoRoot = resolve(import.meta.dir, '../..')
export const baselineDir = join(repoRoot, 'scripts/architecture-baselines')

export interface Source {
  /** Repository-relative path with forward slashes. */
  file: string
  /** Comment-stripped source with offsets preserved. */
  code: string
  /** Raw source, for the parser. */
  raw: string
}

export interface ImportRef {
  spec: string
  /** Every binding is `type`-only, so the import is erased at build time. */
  typeOnly: boolean
  /** Named bindings the import brings in (local names). */
  names: string[]
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u
const TEST_FILE = /(?:\.(?:dom\.)?test\.[cm]?[jt]sx?$|\.test-utils\.[jt]sx?$|test-harness\.[jt]s$)/u

export const isTest = (file: string): boolean =>
  TEST_FILE.test(file) || /(?:^|\/)(?:__tests__|testing|fixtures)\//u.test(file)

let tracked: string[] | undefined
function repoFiles(): string[] {
  tracked ??= execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((file) => file && SOURCE_FILE.test(file) && !file.includes('node_modules/'))
  return tracked
}

/** Source files under any of the prefixes, tests included only when asked. */
export function loadSources(prefixes: readonly string[], options: { tests?: boolean } = {}) {
  const sources: Source[] = []
  for (const file of repoFiles()) {
    if (!prefixes.some((prefix) => file.startsWith(prefix))) continue
    if (!options.tests && isTest(file)) continue
    const path = join(repoRoot, file)
    if (!existsSync(path)) continue
    const raw = readFileSync(path, 'utf8')
    sources.push({ file, raw, code: codeOnly(raw) })
  }
  if (sources.length === 0) throw new Error(`no sources under ${prefixes.join(', ')}`)
  return sources
}

/** A planted source for positive controls. */
export const planted = (file: string, raw: string): Source => ({ file, raw, code: codeOnly(raw) })

export function importsOf(source: Source): ImportRef[] {
  const parsed = parseSync(source.file, source.raw)
  const refs: ImportRef[] = []
  for (const entry of parsed.module.staticImports) {
    const names = entry.entries.map((item) => item.localName.value)
    const typeOnly = entry.entries.length > 0 && entry.entries.every((item) => item.isType)
    refs.push({ spec: entry.moduleRequest.value, typeOnly, names })
  }
  for (const entry of parsed.module.staticExports) {
    for (const item of entry.entries) {
      if (item.moduleRequest)
        refs.push({ spec: item.moduleRequest.value, typeOnly: item.isType, names: [] })
    }
  }
  for (const { moduleRequest } of parsed.module.dynamicImports) {
    const literal = source.raw.slice(moduleRequest.start, moduleRequest.end)
    if (/^['"].*['"]$/u.test(literal))
      refs.push({ spec: literal.slice(1, -1), typeOnly: false, names: [] })
  }
  return refs
}

/** Repository-relative target of a relative or `@/` specifier, without extension or `/index`. */
export function resolveSpec(from: string, spec: string): string | null {
  let target: string
  if (spec.startsWith('.')) target = normalize(join(dirname(from), spec))
  else if (spec.startsWith('@/') && from.startsWith('apps/ui/'))
    target = `apps/ui/src/${spec.slice(2)}`
  else return null
  return target
    .replaceAll('\\', '/')
    .replace(/\.(?:[cm]?[jt]sx?)$/u, '')
    .replace(/\/index$/u, '')
}

export const moduleId = (file: string) =>
  file.replace(/\.(?:[cm]?[jt]sx?)$/u, '').replace(/\/index$/u, '')

export interface Rule {
  id: string
  /** One line: what to do instead. */
  fix: string
  detect: (sources: Source[]) => string[]
}

function baselinePath(rule: Rule) {
  return join(baselineDir, `${rule.id.toLowerCase()}.json`)
}

export function readBaseline(rule: Rule): string[] {
  const path = baselinePath(rule)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as string[]) : []
}

/**
 * New violations and stale baseline entries, as failure lines carrying the rule id and the fix.
 * `ARCHITECTURE_BASELINE=write` rewrites the baseline instead — only to record a deliberate
 * shrink or the first adoption of a rule, never to admit a new violation.
 */
export function ratchet(rule: Rule, found: readonly string[], recorded?: readonly string[]) {
  const current = [...new Set(found)].sort()
  if (!recorded && process.env.ARCHITECTURE_BASELINE === 'write') {
    writeFileSync(baselinePath(rule), `${JSON.stringify(current, null, 2)}\n`)
    return []
  }
  const baseline = new Set(recorded ?? readBaseline(rule))
  const seen = new Set(current)
  const where = relative(repoRoot, baselinePath(rule))
  return [
    ...current
      .filter((key) => !baseline.has(key))
      .map((key) => `${rule.id} ${key} — fix: ${rule.fix}`),
    ...[...baseline]
      .filter((key) => !seen.has(key))
      .map((key) => `${rule.id} stale baseline entry ${key} — fix: remove it from ${where}`),
  ]
}

/** Strongly connected components with more than one node (Tarjan). */
export function cycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let index = 0
  const stack: string[] = []
  const onStack = new Set<string>()
  const indices = new Map<string, number>()
  const low = new Map<string, number>()
  const components: string[][] = []
  const visit = (node: string) => {
    indices.set(node, index)
    low.set(node, index++)
    stack.push(node)
    onStack.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, indices.get(next)!))
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = []
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== node)
      if (component.length > 1) components.push(component.sort())
    }
  }
  for (const node of graph.keys()) if (!indices.has(node)) visit(node)
  return components
}

/** Edges whose two ends sit in the same cycle, as `a -> b`. */
export function cyclicEdges(graph: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const componentOf = new Map<string, number>()
  cycles(graph).forEach((component, at) => component.forEach((node) => componentOf.set(node, at)))
  const edges: string[] = []
  for (const [from, targets] of graph) {
    for (const to of targets) {
      const component = componentOf.get(from)
      if (component !== undefined && componentOf.get(to) === component)
        edges.push(`${from} -> ${to}`)
    }
  }
  return edges
}

export function addEdge(graph: Map<string, Set<string>>, from: string, to: string) {
  if (from === to) return
  if (!graph.has(from)) graph.set(from, new Set())
  if (!graph.has(to)) graph.set(to, new Set())
  graph.get(from)!.add(to)
}
