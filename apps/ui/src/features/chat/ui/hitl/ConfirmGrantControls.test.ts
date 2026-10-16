import { describe, expect, test } from 'bun:test'
import { deepestTarget, scopeTrail, type ConfirmGrantOption } from './ConfirmGrantControls'

const folder = (target: string): ConfirmGrantOption => ({
  id: `read(${target}/*)`,
  kind: 'folder',
  label: target.split(/[/\\]/u).pop()!,
  covers: `anything inside ${target}`,
  target,
})

describe('the scope trail', () => {
  test('segments match the levels that name them; the ungrantable top is one address', () => {
    const grants = [folder('/Users/me/code/app/src'), folder('/Users/me/code/app')]
    const { prefix, crumbs } = scopeTrail('/Users/me/code/app/src/main.ts', grants)
    expect(prefix).toBe('/Users/me/code')
    expect(crumbs.map((crumb) => [crumb.name, crumb.grant?.target])).toEqual([
      ['app', '/Users/me/code/app'],
      ['src', '/Users/me/code/app/src'],
      // The file itself was not offered here, so it is a name, not a level.
      ['main.ts', undefined],
    ])
  })

  test('a trail nothing on which is grantable is drawn whole, with no steps', () => {
    const { prefix, crumbs } = scopeTrail('/etc/hosts', [])
    expect(prefix).toBe('/etc')
    expect(crumbs).toEqual([{ name: 'hosts' }])
  })

  test('a Windows path is cut at its own separator', () => {
    const { prefix, crumbs } = scopeTrail('C:\\Users\\me\\app\\a.ts', [
      folder('C:\\Users\\me\\app'),
    ])
    expect(prefix).toBe('C:\\Users\\me')
    expect(crumbs.map((crumb) => crumb.name)).toEqual(['app', 'a.ts'])
  })

  test('the trail of several paths is their deepest offered folder', () => {
    expect(deepestTarget([folder('/a/b'), folder('/a/b/c'), folder('/a')])).toBe('/a/b/c')
    expect(deepestTarget([{ id: 'bash(git)', kind: 'program', label: 'git', covers: 'git' }])).toBe(
      undefined,
    )
  })
})
