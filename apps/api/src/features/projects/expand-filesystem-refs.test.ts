import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeDir } from '@localixai/testing'

import { statFileRef } from './expand-filesystem-refs'

describe('statFileRef — the checks a file ref passes before it is read or sized', () => {
  let dir: string
  beforeAll(async () => {
    dir = makeTempDir('localix-stat-file-ref')
    await writeFile(path.join(dir, 'a.ts'), 'const a = 1\n')
    await mkdir(path.join(dir, '.ssh'))
    await writeFile(path.join(dir, '.ssh', 'config'), 'Host x\n')
  })
  afterAll(() => removeDir(dir))

  test('a file inside the working directory resolves with its byte size', async () => {
    expect(await statFileRef(dir, { raw: '@file:a.ts', kind: 'file', path: 'a.ts' })).toEqual({
      resolved: path.join(dir, 'a.ts'),
      size: 'const a = 1\n'.length,
    })
  })

  test('a file under a credential folder is refused before it is touched', async () => {
    const ref = { raw: '@file:.ssh/config', kind: 'file' as const, path: '.ssh/config' }
    expect(await statFileRef(dir, ref)).toEqual({
      refused: {
        raw: ref.raw,
        ok: false,
        error: 'path looks like a sensitive credential file',
        chars: 0,
      },
    })
  })
})
