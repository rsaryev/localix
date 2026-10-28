import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setReadableHostRoots } from '../../lib/host-roots'
import { isOutsideWorkspace } from './workspace-containment'

const kit = mkdtempSync(path.join(tmpdir(), 'kit-'))
const declarations = path.join(kit, 'backend.d.ts')
writeFileSync(declarations, 'export {}')
const project = mkdtempSync(path.join(tmpdir(), 'project-'))

afterEach(() => setReadableHostRoots(() => []))

describe('the mini app kit, outside the session workspace', () => {
  test('read and search of its declarations raise no outside-workspace question', () => {
    setReadableHostRoots(() => [kit])
    expect(isOutsideWorkspace('Read', project, declarations)).toBe(false)
    expect(isOutsideWorkspace('Search', project, kit)).toBe(false)
  })

  test('writes and shell commands into it are still outside', () => {
    setReadableHostRoots(() => [kit])
    expect(isOutsideWorkspace('Write', project, declarations)).toBe(true)
    expect(isOutsideWorkspace('Edit', project, declarations)).toBe(true)
    expect(isOutsideWorkspace('Bash', project, declarations)).toBe(true)
  })

  test('without the exemption a read of it is outside', () => {
    expect(isOutsideWorkspace('Read', project, declarations)).toBe(true)
  })
})
