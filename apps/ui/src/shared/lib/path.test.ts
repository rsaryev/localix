import { describe, expect, test } from 'bun:test'
import { relativePath } from '@localixai/plugin-sdk/ui/utilities'

describe('relativePath', () => {
  test('strips the workspace root prefix', () => {
    expect(relativePath('/home/u/proj', '/home/u/proj/src/a.ts')).toBe('src/a.ts')
  })

  test('tolerates a trailing slash on root', () => {
    expect(relativePath('/home/u/proj/', '/home/u/proj/src/a.ts')).toBe('src/a.ts')
  })

  test('root itself → its base name', () => {
    expect(relativePath('/home/u/proj', '/home/u/proj')).toBe('proj')
  })

  test('path outside root → falls back to the absolute path', () => {
    expect(relativePath('/home/u/proj', '/etc/hosts')).toBe('/etc/hosts')
  })

  test('empty root → absolute path', () => {
    expect(relativePath('', '/home/u/proj/a.ts')).toBe('/home/u/proj/a.ts')
  })

  test('does not treat a sibling dir with a shared prefix as inside', () => {
    expect(relativePath('/home/u/proj', '/home/u/proj-other/a.ts')).toBe('/home/u/proj-other/a.ts')
  })
})
