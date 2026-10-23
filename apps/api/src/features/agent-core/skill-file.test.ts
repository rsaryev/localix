import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import {
  MAX_SKILL_MARKDOWN_BYTES,
  readSkillMarkdownFile,
  readSkillMarkdownFileSync,
  SkillFileReadError,
} from './skill-file'

const dir = tempDirPerTest('localix-skill-file-')

/** Run both readers, so the async path and its synchronous twin keep one contract. */
async function readBoth(path: string): Promise<Array<string | SkillFileReadError>> {
  const settle = async (read: () => Promise<string> | string) => {
    try {
      return await read()
    } catch (error) {
      if (error instanceof SkillFileReadError) return error
      throw error
    }
  }
  return [
    await settle(() => readSkillMarkdownFile(path)),
    await settle(() => readSkillMarkdownFileSync(path)),
  ]
}

describe('reading a skill markdown file', () => {
  test('a regular file reads whole', async () => {
    const path = join(dir(), 'SKILL.md')
    writeFileSync(path, '---\nname: x\n---\nBody.')
    expect(await readBoth(path)).toEqual(['---\nname: x\n---\nBody.', '---\nname: x\n---\nBody.'])
  })

  test('a file over the ceiling is refused, not truncated', async () => {
    const path = join(dir(), 'big.md')
    writeFileSync(path, 'a'.repeat(MAX_SKILL_MARKDOWN_BYTES + 1))
    for (const result of await readBoth(path)) {
      expect(result).toBeInstanceOf(SkillFileReadError)
      expect((result as SkillFileReadError).code).toBe('too_large')
    }
  })

  test('a directory is not a regular file', async () => {
    const path = join(dir(), 'folder.md')
    mkdirSync(path)
    for (const result of await readBoth(path)) {
      expect(result).toBeInstanceOf(SkillFileReadError)
      expect((result as SkillFileReadError).code).toBe('not_regular_file')
    }
  })
})
