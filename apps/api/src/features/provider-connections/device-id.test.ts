import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDeviceIdGetter } from './device-id'

test('creates the installation UUID lazily and retains it across getter instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localix-oauth-device-'))
  const file = join(dir, 'home', 'oauth-device-id')
  try {
    const first = createDeviceIdGetter(file)
    const second = createDeviceIdGetter(file)
    expect(existsSync(file)).toBe(false)
    const id = first()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first()).toBe(id)
    expect(second()).toBe(id)
    expect(createDeviceIdGetter(file)()).toBe(id)
    expect(readFileSync(file, 'utf8')).toBe(id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reports a corrupt identity instead of silently replacing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localix-oauth-device-'))
  const file = join(dir, 'oauth-device-id')
  try {
    writeFileSync(file, 'not-a-uuid')
    expect(createDeviceIdGetter(file)).toThrow('Stored OAuth installation ID is not a UUID')
    expect(readFileSync(file, 'utf8')).toBe('not-a-uuid')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
