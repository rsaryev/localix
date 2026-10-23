import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const uiRoot = new URL('..', import.meta.url).pathname

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

test('the metadata chip is described once, in dbBadge.ts', () => {
  // The recipe's signature: a rounded tag on the foreground veil with tag padding. Five copies had
  // drifted (ring / no ring, py-px / none, 2xs / 3xs, soft / faint text) before it was shared.
  const signature = /rounded-sm bg-foreground\/\[0\.06\] px-1/
  const copies = sources(uiRoot).filter(
    (path) => !path.endsWith('/dbBadge.ts') && signature.test(readFileSync(path, 'utf8')),
  )
  expect(copies).toEqual([])
})

test('the scan sees the recipe where it is defined (positive control)', () => {
  const own = readFileSync(new URL('./dbBadge.ts', import.meta.url), 'utf8')
  expect(own).toMatch(/rounded-sm bg-foreground\/\[0\.06\] px-1/)
})
