import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertUpdaterEmbedded,
  readUpdaterSettings,
  writeReleaseConfig,
} from './build-release-config.mjs'

// Bun loads this package's ignored .env.local into process.env. Passing that
// environment explicitly is important: Bun's package-script shell does not
// propagate dotenv-only values to native executables such as the Tauri CLI.
const rawArgs = process.argv.slice(2)
const notarizeDmg = rawArgs.includes('--notarize-dmg')
// A release build: signed updater bundles AND an updater compiled into the app. Without this flag the
// app has no updater at all (`build.rs`), whatever else was passed.
const releaseBuild = rawArgs.includes('--release')
const args = rawArgs.filter((arg) => arg !== '--notarize-dmg' && arg !== '--release')
const startedAt = Date.now()
const commandEnv = { ...process.env }

// `tauri:release` is intentionally strict and fails before the expensive build.
// Plain `tauri:build` is deliberately isolated from any Apple credentials loaded
// by Bun from .env.local. Otherwise Tauri sees those ambient variables and submits
// every local build to Apple's rate-limited notarization service.
if (notarizeDmg && process.platform === 'darwin') {
  const required = [
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'APPLE_SIGNING_IDENTITY',
    'APPLE_API_KEY',
    'APPLE_API_ISSUER',
    'APPLE_API_KEY_PATH',
  ]
  const missing = required.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    console.error(`[tauri-release] Missing signing/notarization environment: ${missing.join(', ')}`)
    process.exit(1)
  }
}

if (releaseBuild) {
  // The overlay adds the updater's key and endpoint and turns on updater artifacts; `build.rs` reads
  // the flag to compile the plugin in. Both or neither: one without the other is a silent no-update app.
  args.push('--config', writeReleaseConfig())
  commandEnv.LOCALIX_UPDATER_ENABLED = '1'
}

if (process.platform === 'darwin' && !notarizeDmg) {
  // Keep ordinary builds runnable while making them incapable of consuming an
  // Apple notarization request. The config signs ad-hoc with `-`; removing every
  // supported credential path also makes Tauri's automatic notarization inert.
  for (const name of [
    'APPLE_SIGNING_IDENTITY',
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'APPLE_ID',
    'APPLE_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_ISSUER',
    'APPLE_API_KEY_PATH',
  ]) {
    delete commandEnv[name]
  }
  args.push('--config', 'src-tauri/tauri.adhoc.conf.json')
}

const run = async (command) => {
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: commandEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return child.exited
}

const exitCode = await run(['bunx', 'tauri', ...args])
if (exitCode !== 0) process.exit(exitCode)

// A release whose updater was left out builds, signs and publishes cleanly and then never updates.
// The public key is in the app's embedded config exactly when the overlay reached the build.
if (releaseBuild) {
  const binary = join(
    process.cwd(),
    'src-tauri',
    'target',
    'release',
    process.platform === 'win32' ? 'desktop-tauri.exe' : 'desktop-tauri',
  )
  try {
    assertUpdaterEmbedded(binary, readUpdaterSettings().pubkey)
    console.log('[tauri-release] the updater public key is in the built app')
  } catch (error) {
    console.error(`[tauri-release] ${error.message}`)
    process.exit(1)
  }
}

// Tauri notarizes and staples the .app before creating a DMG, but only signs the
// resulting DMG. A release DMG gets its own Apple ticket so Gatekeeper can assess
// the downloaded container itself, not only the app inside it.
if (notarizeDmg && process.platform === 'darwin') {
  const dmgs = []
  const collectDmgs = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name)
      if (entry.isDirectory()) collectDmgs(entryPath)
      else if (entry.name.endsWith('.dmg') && statSync(entryPath).mtimeMs >= startedAt - 2_000) {
        dmgs.push(entryPath)
      }
    }
  }
  collectDmgs(join(process.cwd(), 'src-tauri', 'target'))
  if (dmgs.length === 0) {
    console.error('[tauri-release] Tauri produced no new DMG to notarize')
    process.exit(1)
  }

  for (const dmg of dmgs) {
    let code = await run([
      'xcrun',
      'notarytool',
      'submit',
      dmg,
      '--key',
      process.env.APPLE_API_KEY_PATH,
      '--key-id',
      process.env.APPLE_API_KEY,
      '--issuer',
      process.env.APPLE_API_ISSUER,
      '--wait',
    ])
    if (code === 0) code = await run(['xcrun', 'stapler', 'staple', dmg])
    if (code === 0) code = await run(['xcrun', 'stapler', 'validate', dmg])
    if (code !== 0) process.exit(code)
  }
}

process.exit(0)
