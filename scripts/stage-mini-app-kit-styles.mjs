// The host theme's stylesheets, copied into the mini app kit with every `@import` rewritten to a
// kit-relative path.
//
// A mini app's utilities are compiled against the host theme (`@reference`), and on an installed
// app there is no source tree or `node_modules` to resolve `@import 'tailwindcss'` from. So staging
// resolves each import ONCE, here, where the packages exist, and the kit carries the resolved
// files: the runtime compiler then only ever reads a relative path inside the kit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const IMPORT = /@import\s+(['"])([^'"]+)\1/gu
/**
 * A host `@source` names the host's own sources, relative to where the host stylesheet lives. In
 * the kit the file sits somewhere else entirely, so the same relative path points up and out of
 * the kit — a mini app build then asked Tailwind to scan an arbitrary directory tree and never
 * finished. A mini app's utilities come from the mini app's sources only, so the host's are
 * dropped.
 */
const SOURCE_DIRECTIVE = /^[ \t]*@source\s[^;]*;[ \t]*\n?/gmu

/** `pkg/sub` → { name, subpath } with scoped names kept whole. */
function splitSpecifier(specifier) {
  const parts = specifier.split('/')
  const count = specifier.startsWith('@') ? 2 : 1
  return { name: parts.slice(0, count).join('/'), subpath: parts.slice(count).join('/') }
}

/** The file a bare CSS import names: `exports` with the `style` condition, then `style`, then a path. */
export function resolveStyleImport(specifier, fromDir) {
  const { name, subpath } = splitSpecifier(specifier)
  const manifestPath = Bun.resolveSync(`${name}/package.json`, fromDir)
  const root = dirname(manifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const key = subpath ? `./${subpath}` : '.'
  const exported = manifest.exports?.[key]
  const target =
    typeof exported === 'string'
      ? exported
      : (exported?.style ?? exported?.default ?? (key === '.' ? manifest.style : undefined))
  const file = resolve(root, target ?? subpath)
  if (!existsSync(file)) throw new Error(`cannot resolve stylesheet "${specifier}" from ${fromDir}`)
  return { file, packageName: name, packageRoot: root }
}

/**
 * Copy `entry` and everything it imports into `outDir`. Host files land under `host/`, a
 * package's files under its name, so `tailwindcss/utilities.css` is where the kit layout says.
 * Returns the kit-relative path of the copied entry.
 */
export function stageHostStylesheets({ entry, outDir, packages = [] }) {
  const hostRoot = dirname(entry)
  const placed = new Map()
  const destinationOf = (file, packageInfo) => {
    const rel = packageInfo
      ? join(packageInfo.packageName, relative(packageInfo.packageRoot, file))
      : join('host', relative(hostRoot, file))
    return join(outDir, rel)
  }
  const visit = (file, packageInfo) => {
    const known = placed.get(file)
    if (known) return known
    const destination = destinationOf(file, packageInfo)
    placed.set(file, destination)
    const source = readFileSync(file, 'utf8')
    const own = packageInfo ? source : source.replace(SOURCE_DIRECTIVE, '')
    const text = own.replace(IMPORT, (_statement, quote, specifier) => {
      const bare = !specifier.startsWith('.') && !specifier.startsWith('/')
      // A relative import stays in the importing file's package, under its OWN path. Building it
      // as `{ file, ...packageInfo }` let the package ENTRY's `file` win, so every relative import
      // inside a package stylesheet became an import of that entry — a stylesheet importing
      // itself, which Tailwind recursed into forever the first time a package had layers.
      let target
      if (bare) {
        const resolved = resolveStyleImport(specifier, dirname(file))
        target = visit(resolved.file, resolved)
      } else {
        target = visit(resolve(dirname(file), specifier), packageInfo)
      }
      const path = relative(dirname(destination), target).split(sep).join('/')
      return `@import ${quote}${path.startsWith('.') ? path : `./${path}`}${quote}`
    })
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, text)
    return destination
  }
  const staged = visit(entry, null)
  // Layers the runtime imports by name even when the host stylesheet does not.
  for (const specifier of packages) {
    const resolved = resolveStyleImport(specifier, hostRoot)
    visit(resolved.file, resolved)
  }
  return relative(outDir, staged).split(sep).join('/')
}
