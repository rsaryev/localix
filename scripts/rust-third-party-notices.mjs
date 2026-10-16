import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const RUST_NOTICES_FILE = 'rust-crates-THIRD_PARTY_NOTICES.txt'
const DESKTOP_MANIFEST = 'apps/desktop-tauri/src-tauri/Cargo.toml'
const NOTICE_BASENAME_RE = /^(?:licen[cs]e|unlicense|copying|copyright|notice)(?:[._-].*)?$/iu

/** `cargo metadata` for the desktop shell, resolved for the target the binary is built for. */
export function readDesktopCargoMetadata({ repoRoot, targetTriple, cargo = 'cargo' }) {
  const args = ['metadata', '--format-version', '1', '--locked']
  args.push('--manifest-path', join(repoRoot, DESKTOP_MANIFEST))
  if (targetTriple) args.push('--filter-platform', targetTriple)
  return JSON.parse(execFileSync(cargo, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
}

/**
 * The crates compiled into the shipped binary: the normal-dependency closure of the workspace
 * root. Build scripts and dev-dependencies run on the build machine and are not distributed.
 */
export function collectRustNoticeCrates(metadata) {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]))
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]))
  const workspace = new Set(metadata.workspace_members)
  const seen = new Set()
  const pending = [metadata.resolve.root]
  while (pending.length > 0) {
    const id = pending.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const dependency of nodes.get(id)?.deps ?? []) {
      if (dependency.dep_kinds.some((kind) => kind.kind === null)) pending.push(dependency.pkg)
    }
  }
  const crates = []
  for (const id of seen) {
    if (workspace.has(id)) continue
    const pkg = packages.get(id)
    const packageRoot = dirname(pkg.manifest_path)
    const notices = readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && NOTICE_BASENAME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
    if (!pkg.license && notices.length === 0) {
      throw new Error(`Crate ${pkg.name}@${pkg.version} has no license metadata or notice file`)
    }
    crates.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      packageRoot,
      notices,
    })
  }
  return crates.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  )
}

export function buildRustNotices(metadata) {
  const crates = collectRustNoticeCrates(metadata)
  const output = [
    'THIRD-PARTY SOFTWARE NOTICES AND INFORMATION',
    '',
    'Rust crates compiled into the desktop shell',
    `Crates: ${crates.length}`,
    '',
  ]
  for (const crate of crates) {
    output.push(
      '='.repeat(80),
      `${crate.name}@${crate.version}`,
      `Declared license: ${crate.license ?? 'UNKNOWN'}`,
    )
    if (crate.notices.length === 0) {
      output.push('No license or notice text was included in the published crate.')
    }
    for (const filename of crate.notices) {
      const content = readFileSync(join(crate.packageRoot, filename), 'utf8').replace(
        /\r\n?/gu,
        '\n',
      )
      output.push(`--- ${filename} ---`, content.trimEnd())
    }
    output.push('')
  }
  return `${output.join('\n').trimEnd()}\n`
}
