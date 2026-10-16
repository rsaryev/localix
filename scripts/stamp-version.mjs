// The one place that knows which files carry the desktop app's version, so the release workflow
// does not rewrite them with an inline script and nothing can drift unnoticed.
//
//   bun scripts/stamp-version.mjs 1.2.3-beta.1    rewrite the three files to that version
//   bun scripts/stamp-version.mjs --check         fail unless the three files agree
//
// `tauri.conf.json` is the version Tauri bakes into the bundle and the updater compares;
// `Cargo.toml` is the crate's; `Cargo.lock` carries the crate's own entry too, and cargo rewrites it
// on a build that is not `--locked`. Stamping all three keeps the release build `--locked`-clean.
// Edits are targeted replacements, so formatting and key order stay exactly as committed.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './lib/paths.mjs'

const SRC_TAURI = ['apps', 'desktop-tauri', 'src-tauri']
const CRATE = 'desktop-tauri'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u

/** Where each file keeps the version: a pattern with the version in group 2, and a label. */
const SITES = [
  {
    file: 'tauri.conf.json',
    // The first `"version"` key is the top-level one; nested objects do not carry one.
    pattern: /^(\s*"version":\s*")([^"]*)(")/mu,
  },
  {
    file: 'Cargo.toml',
    // The first bare `version = "…"` line is `[package]`'s; dependencies use inline tables.
    pattern: /^(version = ")([^"]*)(")/mu,
  },
  {
    file: 'Cargo.lock',
    pattern: new RegExp(
      `(\\[\\[package\\]\\]\\r?\\nname = "${CRATE}"\\r?\\nversion = ")([^"]*)(")`,
      'u',
    ),
  },
]

export const repoRootFromHere = repoRoot

const pathOf = (repoRoot, file) => join(repoRoot, ...SRC_TAURI, file)

/** The version each file currently carries, by file name. */
export function readVersions(repoRoot) {
  return Object.fromEntries(
    SITES.map(({ file, pattern }) => {
      const match = pattern.exec(readFileSync(pathOf(repoRoot, file), 'utf8'))
      if (!match) throw new Error(`${file}: no version found`)
      return [file, match[2]]
    }),
  )
}

/** Throw unless every file carries the same version; returns it. */
export function assertConsistent(repoRoot) {
  const versions = readVersions(repoRoot)
  const distinct = new Set(Object.values(versions))
  if (distinct.size !== 1) {
    const rows = Object.entries(versions).map(([file, version]) => `  ${file}: ${version}`)
    throw new Error(`The desktop app's version differs between files:\n${rows.join('\n')}`)
  }
  return [...distinct][0]
}

/** Rewrite every site to `version`. Throws, writing nothing, when the version or a file is wrong. */
export function stampVersion(repoRoot, version) {
  if (!SEMVER.test(version)) throw new Error(`Not a semantic version: ${JSON.stringify(version)}`)
  const rewritten = SITES.map(({ file, pattern }) => {
    const path = pathOf(repoRoot, file)
    const text = readFileSync(path, 'utf8')
    if (!pattern.test(text)) throw new Error(`${file}: no version found to stamp`)
    return { path, text: text.replace(pattern, `$1${version}$3`) }
  })
  for (const { path, text } of rewritten) writeFileSync(path, text)
  return version
}

function main() {
  const [arg] = process.argv.slice(2)
  const repoRoot = repoRootFromHere()
  try {
    if (arg === '--check') {
      console.log(
        `[stamp-version] ${assertConsistent(repoRoot)} in tauri.conf.json, Cargo.toml, Cargo.lock`,
      )
    } else if (arg) {
      const stamped = stampVersion(repoRoot, arg)
      assertConsistent(repoRoot)
      console.log(`[stamp-version] stamped ${stamped}`)
    } else {
      console.error('usage: stamp-version.mjs <version> | --check')
      process.exitCode = 2
    }
  } catch (error) {
    console.error(`[stamp-version] ${error.message}`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
