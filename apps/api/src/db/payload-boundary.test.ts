import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The stored payload vocabulary is below every feature: features read and write it, so it may
 * not import one back (migration plan, Stage 4). Shared shapes it needs live in `src/contracts/`.
 */
test('db/payload.ts imports no feature module', () => {
  const source = readFileSync(join(import.meta.dir, 'payload.ts'), 'utf8')
  const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'/gu)].map((match) => match[1]!)
  expect(specifiers.filter((spec) => spec.includes('/features/'))).toEqual([])
})
