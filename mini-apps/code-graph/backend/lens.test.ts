import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodeCard } from '../shared/lens'
import { ProjectIndex } from './indexing/project-index'
import { buildLens, cellOf } from './lens'

const made: string[] = []
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-lens-'))
  made.push(root)
  writeFileSync(
    join(root, 'a.ts'),
    [
      "import { normalize, LIMIT, type Options } from './b'",
      "import * as util from './c'",
      'export function applyFix(text: string, opts: Options) {',
      "\tconst label = 'é'; const t = normalize(text)",
      '  return util.clamp(t, LIMIT)',
      '}',
      'export function onInput() { applyFix("x", {}) }',
      'export class Editor {',
      '  run() { this.fix() }',
      "  fix() { applyFix('y', {}) }",
      '}',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'b.ts'),
    [
      'export function normalize(t: string) {',
      '  return t.trim()',
      '}',
      'export const LIMIT = 10',
      'export interface Options { strict?: boolean }',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'c.ts'),
    'export function clamp(t: string, n: number) { return t.slice(0, n) }\n',
  )
  const index = new ProjectIndex(root, join(root, '.cache'))
  const published = await index.refresh()
  if (!published) throw new Error('no graph')
  return { root, index, graph: published.graph }
}

/** Each link as `kind token → target`, reading the token back out of the card's own text. */
const links = (card: CodeCard | undefined) =>
  (card?.links ?? []).map((link) => {
    const token = card?.lines[link.line - card.startLine]?.slice(link.column, link.endColumn)
    return `${link.kind} ${token} → ${link.target.id}`
  })

describe('buildLens', () => {
  test('every resolved name is a link at its token: calls, types, constants, namespace members', async () => {
    const { root, index, graph } = await project()
    const lens = await buildLens(graph, root, ['sym:a.ts#applyFix', 'sym:b.ts#normalize'], (p) =>
      index.cachedHash(p),
    )
    const [first, second] = lens?.trail ?? []
    expect(first?.startLine).toBe(3)
    // The tab is expanded to two cells, and `é` before the call must not shift it.
    expect(first?.lines[1]).toBe("  const label = 'é'; const t = normalize(text)")
    // Locals and parameters (`label`, `t`, `text`, `opts`) are not links; everything declared in
    // the project is.
    expect(links(first)).toEqual([
      'ref Options → sym:b.ts#Options',
      'call normalize → sym:b.ts#normalize',
      'call clamp → sym:c.ts#clamp',
      'ref LIMIT → sym:b.ts#LIMIT',
    ])
    expect(first?.callees.map((c) => c.id)).toEqual(['sym:b.ts#normalize', 'sym:c.ts#clamp'])
    expect(first?.outline.map((c) => c.name)).toEqual(['a.ts', 'applyFix'])
    expect(first?.stale).toBe(false)
    expect(second?.lines[0]).toBe('export function normalize(t: string) {')
    expect(lens?.callers.map((c) => c.id).sort()).toEqual([
      'sym:a.ts#Editor.fix',
      'sym:a.ts#onInput',
    ])
    index.close()
  })

  test('a class card carries its members’ links; a member card’s outline climbs through the class', async () => {
    const { root, index, graph } = await project()
    const lens = await buildLens(graph, root, ['sym:a.ts#Editor', 'sym:a.ts#Editor.fix'], (p) =>
      index.cachedHash(p),
    )
    const [cls, method] = lens?.trail ?? []
    expect(links(cls)).toEqual([
      'call fix → sym:a.ts#Editor.fix',
      'call applyFix → sym:a.ts#applyFix',
    ])
    expect(method?.outline.map((c) => `${c.kind}:${c.name}`)).toEqual([
      'file:a.ts',
      'class:Editor',
      'method:fix',
    ])
    index.close()
  })

  test('constants and types open as cards; files do not; an edited file is marked stale', async () => {
    const { root, index, graph } = await project()
    const hash = (p: string) => index.cachedHash(p)
    expect((await buildLens(graph, root, ['sym:b.ts#LIMIT'], hash))?.trail[0]?.lines).toEqual([
      'export const LIMIT = 10',
    ])
    expect((await buildLens(graph, root, ['sym:b.ts#Options'], hash))?.trail[0]?.node.kind).toBe(
      'interface',
    )
    expect(await buildLens(graph, root, ['file:a.ts'], hash)).toBeNull()
    writeFileSync(join(root, 'c.ts'), 'export function clamp(t: string) { return t }\n')
    expect((await buildLens(graph, root, ['sym:c.ts#clamp'], hash))?.trail[0]?.stale).toBe(true)
    index.close()
  })

  test('string offsets become cells of the tab-expanded line', () => {
    expect(cellOf('\tx', 1)).toBe(2)
    expect(cellOf('é = f()', 'é = '.length)).toBe(4)
  })
})
