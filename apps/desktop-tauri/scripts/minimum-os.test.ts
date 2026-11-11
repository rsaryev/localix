import { describe, expect, test } from 'bun:test'
import { minimumOsProblems, parseMinimumOs } from './minimum-os.mjs'

/**
 * The app says it runs on macOS 13 (`tauri.macos.conf.json` `minimumSystemVersion`), but each
 * Mach-O inside it carries its own floor, and the loader enforces that one. A bundled Bun built for
 * macOS 14 would ship in an app that installs on 13 and dies at launch. `otool -l` shows the floor.
 */
const FAT = `/app/Localix (architecture x86_64):
Load command 0
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __PAGEZERO
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 10.15
      sdk 14.2
   ntools 1
/app/Localix (architecture arm64):
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 11.0
      sdk 14.2
   ntools 1
`

const OLD_STYLE = `/app/bun:
Load command 8
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.13
      sdk 10.14
`

describe('the floor each binary sets', () => {
  test('reads every architecture of a universal binary', () => {
    expect(parseMinimumOs(FAT)).toEqual([
      { arch: 'x86_64', minos: '10.15' },
      { arch: 'arm64', minos: '11.0' },
    ])
  })

  test('reads the older load command a binary built before LC_BUILD_VERSION carries', () => {
    expect(parseMinimumOs(OLD_STYLE)).toEqual([{ arch: 'native', minos: '10.13' }])
  })

  test('ignores a build version for another platform', () => {
    expect(
      parseMinimumOs(FAT.replace(' platform 1\n    minos 11.0', ' platform 6\n    minos 14.0')),
    ).toEqual([{ arch: 'x86_64', minos: '10.15' }])
  })
})

describe('against what the app declares', () => {
  test('a binary at or below the declared floor passes', () => {
    expect(minimumOsProblems('Localix', parseMinimumOs(FAT), '13.0')).toEqual([])
    expect(minimumOsProblems('bun', [{ arch: 'arm64', minos: '13.0' }], '13.0')).toEqual([])
  })

  test('one that needs a newer macOS is named, per architecture, compared as numbers', () => {
    expect(
      minimumOsProblems(
        'bun',
        [
          { arch: 'x86_64', minos: '13.0' },
          { arch: 'arm64', minos: '13.10' },
        ],
        '13.9',
      ),
    ).toEqual(['bun (arm64) needs macOS 13.10, but the app declares 13.9'])
  })

  test('a binary with no floor at all is a problem, not a pass', () => {
    expect(minimumOsProblems('bun', [], '13.0')).toEqual([
      'bun has no macOS minimum in its load commands',
    ])
  })
})
