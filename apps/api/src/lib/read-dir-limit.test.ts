import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readDirentsLimit } from './read-dir-limit'

describe('readDirentsLimit', () => {
  test('streams a bounded prefix and reports truncation', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'dir-limit-'))
    try {
      await Promise.all([fs.writeFile(join(dir, 'a'), ''), fs.writeFile(join(dir, 'b'), '')])
      const bounded = await readDirentsLimit(dir, 1)
      expect(bounded.entries).toHaveLength(1)
      expect(bounded.truncated).toBe(true)

      const complete = await readDirentsLimit(dir, 10)
      expect(complete.entries.map((entry) => entry.name).sort()).toEqual(['a', 'b'])
      expect(complete.truncated).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects invalid limits before opening the directory', async () => {
    expect(readDirentsLimit('/unused', -1)).rejects.toThrow('non-negative safe integer')
  })
})
