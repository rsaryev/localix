import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The format knows nothing of a host: a plugin written to it loads in Claude Code and in Localix
 * alike, so this package imports zod and its own files, never a Localix package or a mini-app
 * concept. A host composes it with its own manifest (`docs/internals/plugins-and-mini-apps.md`).
 */
test('the plugin format imports nothing of Localix', () => {
  const offenders = readdirSync(import.meta.dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) =>
      [...readFileSync(join(import.meta.dir, file), 'utf8').matchAll(/from '([^']+)'/g)]
        .map((match) => match[1]!)
        .filter((spec) => !spec.startsWith('.') && spec !== 'zod')
        .map((spec) => `${file} imports ${spec}`),
    )
  expect(offenders).toEqual([])
})
