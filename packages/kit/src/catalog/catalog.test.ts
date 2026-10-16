import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'

import { KIT_CATALOG, KIT_CATEGORY_ORDER, renderKitCatalog } from '.'

const ENTRIES = join(import.meta.dir, '..', 'entries')
const PREFIX = '@localixai/kit/'

/** The names a door exports, read from its explicit re-export list. */
function doorExports(id: string): Set<string> {
  const file = join(ENTRIES, `${id}.ts`)
  const { module } = parseSync(file, readFileSync(file, 'utf8'))
  return new Set(
    module.staticExports.flatMap((statement) =>
      statement.entries.flatMap((entry) =>
        entry.exportName.kind === 'Name' && entry.exportName.name ? [entry.exportName.name] : [],
      ),
    ),
  )
}

const doors = readdirSync(ENTRIES)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.slice(0, -3))
const kitEntries = KIT_CATALOG.filter((entry) => entry.provider === 'kit')

describe('kit catalog', () => {
  // A door without an entry is a primitive nobody is told about — the agent that hand-rolled tabs
  // and a checkbox did so because it was never told they existed.
  test('every door of the package has exactly one entry, and every kit entry is a door', () => {
    const described = kitEntries.map((entry) => entry.specifier.slice(PREFIX.length))
    expect(doors.length).toBeGreaterThan(0)
    expect(doors.filter((id) => !described.includes(id))).toEqual([])
    expect(described.filter((id) => !doors.includes(id))).toEqual([])
    expect(described.length).toBe(new Set(described).size)
  })

  test('an entry names only exports its door really has', () => {
    const invented = kitEntries.flatMap((entry) => {
      const id = entry.specifier.slice(PREFIX.length)
      const exported = doorExports(id)
      return entry.exports.filter((name) => !exported.has(name)).map((name) => `${id}: ${name}`)
    })
    expect(invented).toEqual([])
  })

  test('the detector sees an invented export', () => {
    // Positive control: `Button` is exported by the button door, `Nonexistent` is not.
    expect(doorExports('button').has('Button')).toBe(true)
    expect(doorExports('button').has('Nonexistent')).toBe(false)
  })

  test('specifiers are unique across providers, and every category is presented', () => {
    const specifiers = KIT_CATALOG.map((entry) => entry.specifier)
    expect(specifiers.length).toBe(new Set(specifiers).size)
    for (const entry of KIT_CATALOG) expect(KIT_CATEGORY_ORDER).toContain(entry.category)
    for (const entry of KIT_CATALOG) {
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(entry.use.length).toBeGreaterThan(0)
      expect(entry.exports.length).toBeGreaterThan(0)
    }
  })

  test('the rendered catalog lists every module once', () => {
    const text = renderKitCatalog()
    for (const entry of KIT_CATALOG) expect(text).toContain(`\`${entry.specifier}\``)
  })
})
