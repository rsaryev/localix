import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRuntimeLogDestination } from './runtime-log-destination'

describe('createRuntimeLogDestination', () => {
  test('creates and repairs the diagnostics file as owner-only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-log-permissions-'))
    const path = join(root, 'nested', 'runtime.log')
    try {
      const first = createRuntimeLogDestination(path)
      first.write('first\n')
      first.end()
      await new Promise<void>((resolve) => first.on('close', resolve))
      expect(statSync(path).mode & 0o777).toBe(0o600)

      chmodSync(path, 0o644)
      writeFileSync(path, 'old\n')
      const reopened = createRuntimeLogDestination(path)
      reopened.write('new\n')
      reopened.end()
      await new Promise<void>((resolve) => reopened.on('close', resolve))
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(readFileSync(path, 'utf8')).toContain('new')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  test('rotates an oversized log instead of appending to it forever', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-log-rotate-'))
    const path = join(root, 'runtime.log')
    try {
      // The sink was append-only with no bound. Measured on a moderately used
      // install: ~393 KB/day, so ~140 MB/year, because every request logs a
      // `request.completed` line and nothing ever truncated the file.
      writeFileSync(path, 'x'.repeat(8 * 1024 * 1024 + 1))

      const destination = createRuntimeLogDestination(path)
      destination.end()
      await new Promise<void>((resolve) => destination.on('close', resolve))

      expect(existsSync(`${path}.old`)).toBe(true)
      expect(statSync(`${path}.old`).size).toBeGreaterThan(8 * 1024 * 1024)
      // The live file restarts empty rather than inheriting the old bytes.
      expect(statSync(path).size).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('leaves a log under the bound untouched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-log-keep-'))
    const path = join(root, 'runtime.log')
    try {
      writeFileSync(path, 'keep me\n')
      const destination = createRuntimeLogDestination(path)
      destination.end()
      await new Promise<void>((resolve) => destination.on('close', resolve))

      expect(existsSync(`${path}.old`)).toBe(false)
      expect(readFileSync(path, 'utf8')).toBe('keep me\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
