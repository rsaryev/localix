// Tauri notarizes the .app, runs `xcrun stapler staple` on it ONCE, and then packs the app into the
// DMG whatever stapler said. When Apple's CloudKit drops the runner's connection (exit 68, see
// apple-retry.mjs), the DMG ships an app with no ticket; the release's verify step then stops it
// (v0.1.0-beta.25's first build). Tauri finds `xcrun` through PATH, so a release build puts this
// `xcrun` first: it asks Apple again until the ticket is stapled AND validates, and hands every
// other call to the real xcrun unchanged.

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`

/** Write `<dir>/xcrun` and return `dir`, to be put first on the Tauri build's PATH. */
export function installStaplerShim(
  dir,
  { realXcrun = '/usr/bin/xcrun', attempts = 4, waitSeconds = 30 } = {},
) {
  mkdirSync(dir, { recursive: true })
  const script = `#!/bin/sh
real=${quote(realXcrun)}
if [ "$1" = stapler ] && [ "$2" = staple ]; then
  shift 2
  for target; do :; done
  attempt=1
  while :; do
    "$real" stapler staple "$@" && "$real" stapler validate "$target" && exit 0
    if [ "$attempt" -ge ${attempts} ]; then
      echo "[tauri-release] no notarization ticket on $target after ${attempts} attempts" >&2
      exit 1
    fi
    echo "[tauri-release] stapling $target failed; asking Apple again" >&2
    attempt=$((attempt + 1))
    sleep ${waitSeconds}
  done
fi
exec "$real" "$@"
`
  const path = join(dir, 'xcrun')
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return dir
}
