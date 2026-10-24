import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The committed snapshots hold our own observations, reduced to names and kinds: no value, prompt,
 * transcript or text of Claude Code's (README.md, "Legal rules"). Every string in a shape is a
 * kind; every key and every surface entry is an identifier.
 */

const DIR = join(import.meta.dir, 'snapshots')
const KINDS = new Set([
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'function',
  'bigint',
  'symbol',
  'object',
  'array',
  '<rejected>',
])
const IDENTIFIER = /^[A-Za-z_$][\w$.:@-]*\??$/

function strayStrings(shape: unknown, path: string): string[] {
  if (typeof shape === 'string') return KINDS.has(shape) ? [] : [`${path}: ${shape}`]
  if (Array.isArray(shape)) return shape.flatMap((item, at) => strayStrings(item, `${path}[${at}]`))
  if (shape && typeof shape === 'object')
    return Object.entries(shape).flatMap(([key, value]) => [
      ...(IDENTIFIER.test(key) ? [] : [`${path}: key ${key}`]),
      ...strayStrings(value, `${path}.${key}`),
    ])
  return [`${path}: ${String(shape)}`]
}

const files = readdirSync(DIR).filter((file) => file.endsWith('.json'))
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8'))

test('there are snapshots to hold to these rules', () => {
  expect(files.some((file) => file.endsWith('.surface.json'))).toBe(true)
  expect(files.some((file) => /^claude-code-[\d.]+\.json$/.test(file))).toBe(true)
})

test.each(files.filter((file) => !file.endsWith('.surface.json')))(
  '%s records names and kinds only',
  (file) => {
    const stray = read(file).entries.flatMap(
      (entry: { kind: string; name: string; shape: unknown }) => [
        ...(IDENTIFIER.test(entry.name) ? [] : [`name ${entry.name}`]),
        ...strayStrings(entry.shape, entry.name),
      ],
    )
    expect(stray).toEqual([])
  },
)

test.each(files.filter((file) => file.endsWith('.surface.json')))('%s lists names only', (file) => {
  const { events, api, renderSites } = read(file)
  const names = [events, api, renderSites].flatMap((section) =>
    Object.entries(section as Record<string, string[]>).flatMap(([name, members]) => [
      name,
      ...members,
    ]),
  )
  expect(names.length).toBeGreaterThan(0)
  expect(names.filter((name) => !IDENTIFIER.test(name))).toEqual([])
})
