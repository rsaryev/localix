// The lowest macOS each binary in a packaged app will load on, against what the app declares.
//
// The app says it runs on `tauri.macos.conf.json` `bundle.macOS.minimumSystemVersion`, and that
// is what the installer and the App Store-style checks read. The loader reads something else: the
// floor in each Mach-O's own load commands. A bundled Bun or a main binary built against a newer
// SDK floor installs fine on the declared macOS and then dies at launch, so the smoke run asks
// `otool -l` for every architecture of the main binary and the bundled Bun.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MACOS_PLATFORM = '1'

/** `[{ arch, minos }]` for each architecture `otool -arch all -l` printed. */
export function parseMinimumOs(output) {
  const found = []
  let arch = 'native'
  let command = ''
  let platform = ''
  for (const line of output.split('\n')) {
    const header = /\(architecture ([^)]+)\):$/u.exec(line)
    if (header) {
      arch = header[1]
      continue
    }
    const [key, value] = line.trim().split(/\s+/u)
    if (key === 'cmd') {
      command = value ?? ''
      platform = ''
    } else if (key === 'platform') platform = value ?? ''
    else if (command === 'LC_BUILD_VERSION' && key === 'minos' && platform === MACOS_PLATFORM)
      found.push({ arch, minos: value })
    else if (command === 'LC_VERSION_MIN_MACOSX' && key === 'version')
      found.push({ arch, minos: value })
  }
  return found
}

/** Compare dotted versions as numbers: 13.10 is newer than 13.9. */
function newer(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/** What is wrong with one binary's floors against the declared minimum; empty when nothing. */
export function minimumOsProblems(name, floors, declared) {
  if (floors.length === 0) return [`${name} has no macOS minimum in its load commands`]
  return floors
    .filter((floor) => newer(floor.minos, declared))
    .map(
      (floor) =>
        `${name} (${floor.arch}) needs macOS ${floor.minos}, but the app declares ${declared}`,
    )
}

/** The minimum the app declares, from the shell's macOS config. */
export function declaredMinimumOs(configPath) {
  return JSON.parse(readFileSync(configPath, 'utf8')).bundle.macOS.minimumSystemVersion
}

/** Every floor problem of a `.app`'s main binary and its bundled Bun. */
export function bundleMinimumOsProblems({ app, bun, declared }) {
  const plist = join(app, 'Contents', 'Info.plist')
  const executable = execFileSync(
    'plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist],
    {
      encoding: 'utf8',
    },
  ).trim()
  const floors = (binary) =>
    parseMinimumOs(execFileSync('otool', ['-arch', 'all', '-l', binary], { encoding: 'utf8' }))
  return [
    ...minimumOsProblems(executable, floors(join(app, 'Contents', 'MacOS', executable)), declared),
    ...minimumOsProblems('bun', floors(bun), declared),
  ]
}
