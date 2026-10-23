import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'

import { KIT_CATALOG } from '@localixai/kit/catalog'

/**
 * The host half of the kit catalog's completeness: the modules the app LENDS under
 * `@localixai/kit/<id>` (`app/kit/*.ts`) are described there too, so a mini app author finds the
 * code editor and the Markdown renderer in the same list as the button. The package's own test
 * pins its doors; it cannot read this directory, which is the app's.
 */
const LENT = join(import.meta.dir, 'kit')
const PREFIX = '@localixai/kit/'

function lentExports(id: string): Set<string> {
  const file = join(LENT, `${id}.ts`)
  const { module } = parseSync(file, readFileSync(file, 'utf8'))
  return new Set(
    module.staticExports.flatMap((statement) =>
      statement.entries.flatMap((entry) =>
        entry.exportName.kind === 'Name' && entry.exportName.name ? [entry.exportName.name] : [],
      ),
    ),
  )
}

const lent = readdirSync(LENT)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.slice(0, -3))
const hostEntries = KIT_CATALOG.filter((entry) => entry.provider === 'host')

describe('kit catalog, host-lent modules', () => {
  test('every lent module has exactly one entry, and every host entry is lent', () => {
    const described = hostEntries.map((entry) => entry.specifier.slice(PREFIX.length))
    expect(lent.length).toBeGreaterThan(0)
    expect(lent.filter((id) => !described.includes(id))).toEqual([])
    expect(described.filter((id) => !lent.includes(id))).toEqual([])
  })

  test('a host entry names only exports the lent module really has', () => {
    const invented = hostEntries.flatMap((entry) => {
      const id = entry.specifier.slice(PREFIX.length)
      const exported = lentExports(id)
      return entry.exports.filter((name) => !exported.has(name)).map((name) => `${id}: ${name}`)
    })
    expect(invented).toEqual([])
  })
})
