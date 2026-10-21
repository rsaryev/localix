import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir, tempDirPerTest } from './temp-dir'

describe('temp dirs', () => {
  test('a tree is written with its nested folders', () => {
    const dir = makeTempDir('tree', { 'a/b/c.txt': 'hi', 'top.txt': 'top' })
    try {
      expect(readFileSync(join(dir, 'a/b/c.txt'), 'utf8')).toBe('hi')
      expect(readFileSync(join(dir, 'top.txt'), 'utf8')).toBe('top')
    } finally {
      removeDir(dir)
    }
  })

  describe('tempDirPerTest', () => {
    const dir = tempDirPerTest('per-test')
    let previous = ''

    test('gives a test its own directory', () => {
      previous = dir()
      expect(existsSync(previous)).toBe(true)
      expect(dir()).toBe(previous)
    })

    test('removes it after the test and hands the next test a new one', () => {
      expect(existsSync(previous)).toBe(false)
      expect(dir()).not.toBe(previous)
    })
  })
})
