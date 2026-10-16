import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { dockBadgeCount } from './useDockBadge'

/**
 * The dock badge has ONE writer. Two modules once wrote the same native badge (this hook with the
 * waiting conversations, the Event Center with its unread count), so it showed whichever changed
 * last. The scan below fails the day a second module starts writing it again.
 */
const uiSrc = resolve(import.meta.dir, '../../..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : []
  })
}

/** Modules that write the native badge: they call the badge setter or the shell command. */
function badgeWriters(files: readonly { path: string; source: string }[]): string[] {
  return files
    .filter(({ source }) => /\bsetDesktopBadge\(|['"]set_badge['"]/u.test(source))
    .map(({ path }) => path)
}

describe('the dock badge', () => {
  test('is written by exactly one module', () => {
    const files = sources(uiSrc)
      .filter((path) => !path.endsWith(join('shared', 'lib', 'desktopBadge.ts')))
      .map((path) => ({ path: relative(uiSrc, path), source: readFileSync(path, 'utf8') }))
    expect(badgeWriters(files)).toEqual([join('features', 'chat', 'model', 'useDockBadge.ts')])
  })

  test('the writer detector sees both ways of writing it (positive control)', () => {
    expect(
      badgeWriters([
        { path: 'a.ts', source: 'setDesktopBadge(unread)' },
        { path: 'b.ts', source: "desktop.invoke('set_badge', { count })" },
        { path: 'c.ts', source: 'const label = "badge"' },
      ]),
    ).toEqual(['a.ts', 'b.ts'])
  })

  test('shows the waiting count, and nothing while the preference is off', () => {
    expect(dockBadgeCount(3, true)).toBe(3)
    expect(dockBadgeCount(3, false)).toBe(0)
  })
})
