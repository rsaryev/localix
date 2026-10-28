import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '../testing/temp'
import { getLocalix, installerFor } from './get-localix'

const tempDir = tempDirPerTest('mini-app-get-localix-')

function releaseOf(file: string, bytes: Uint8Array<ArrayBuffer>, published: Uint8Array = bytes) {
  const sum = createHash('sha256').update(published).digest('hex')
  return (async (url: string | URL) => {
    if (String(url).endsWith('/SHA256SUMS.txt')) return new Response(`${sum}  ${file}\n`)
    if (String(url).endsWith(`/${file}`)) return new Response(bytes)
    return new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
}

test('each computer gets the installer the release publishes for it', () => {
  expect(installerFor('darwin', 'arm64')).toBe('Localix-macos-arm64.dmg')
  expect(installerFor('linux', 'x64')).toBe('Localix-linux-x64.AppImage')
  expect(installerFor('win32', 'x64')).toBeNull()
})

describe('getLocalix', () => {
  test('on macOS, a verified disk image is mounted, the app copied out and opened', async () => {
    const commands: string[][] = []
    const applications = join(tempDir(), 'Applications')
    const got = await getLocalix({
      env: { LOCALIX_RELEASES: 'https://releases.test' },
      platform: 'darwin',
      arch: 'arm64',
      app: null,
      applications,
      fetch: releaseOf('Localix-macos-arm64.dmg', new Uint8Array([7, 7, 7])),
      exec: async (command) => {
        commands.push(command)
      },
    })
    expect(got).toEqual({ path: join(applications, 'Localix.app'), existing: false })
    expect(commands.map((command) => command[0])).toEqual(['hdiutil', 'ditto', 'hdiutil', 'open'])
    expect(commands.at(-1)).toEqual(['open', join(applications, 'Localix.app')])
  })

  test('an installer that does not match its checksum is never opened', async () => {
    const commands: string[][] = []
    await expect(
      getLocalix({
        env: { LOCALIX_RELEASES: 'https://releases.test' },
        platform: 'darwin',
        arch: 'arm64',
        app: null,
        applications: tempDir(),
        fetch: releaseOf('Localix-macos-arm64.dmg', new Uint8Array([1]), new Uint8Array([2])),
        exec: async (command) => {
          commands.push(command)
        },
      }),
    ).rejects.toThrow('checksum')
    expect(commands).toEqual([])
  })

  test('an installed Localix is opened, not downloaded again', async () => {
    const commands: string[][] = []
    const got = await getLocalix({
      platform: 'darwin',
      arch: 'arm64',
      app: '/Applications/Localix.app',
      fetch: (() => {
        throw new Error('fetched')
      }) as unknown as typeof fetch,
      exec: async (command) => {
        commands.push(command)
      },
    })
    expect(got.existing).toBe(true)
    expect(commands).toEqual([['open', '/Applications/Localix.app']])
  })

  test('on Linux, the AppImage is kept in ~/Applications and made executable', async () => {
    const home = tempDir()
    const got = await getLocalix({
      env: { LOCALIX_RELEASES: 'https://releases.test' },
      home,
      platform: 'linux',
      arch: 'x64',
      fetch: releaseOf('Localix-linux-x64.AppImage', new Uint8Array([9])),
    })
    expect(got.path).toBe(join(home, 'Applications', 'Localix.AppImage'))
    expect([...readFileSync(got.path)]).toEqual([9])
    expect(statSync(got.path).mode & 0o111).not.toBe(0)
  })
})
