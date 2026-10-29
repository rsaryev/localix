// THE MINI APP CONTRACT: what a mini app may rely on from Localix, read out of a staged kit as one
// text, the way VS Code keeps its extension API in one declaration file. Every module Localix owns
// that a mini app may import, each export as its declaration (comments dropped), every Localix type
// those declarations reach, the third-party packages the host lends and their versions, and the
// module names the host serves at runtime.
//
// The committed copy (`packages/mini-app-sdk/mini-app.api.md`) is the contract; the kit carries the
// text it was staged with (`API.md`, its digest in `kit.json`). `check-mini-app-contract.mjs`
// fails when the two differ, so a change to what mini apps see is a reviewed diff, and refuses a
// change that breaks a mini app built against the committed one without a new `apiVersion`.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import ts from '@localixai/mini-app-kit-compiler'

export const CONTRACT_FILE = 'packages/mini-app-sdk/mini-app.api.md'
export const KIT_CONTRACT_FILE = 'API.md'

const OWNED = '@localixai/'

/** Plain string order, the same on every machine (`localeCompare` is not). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** The digest a kit and a running Localix name their contract by. */
export const contractDigest = (text) => createHash('sha256').update(text).digest('hex')

const plainPrinter = ts.createPrinter({ removeComments: true })

/**
 * A declaration as the contract writes it: its unions' members, and the properties of its object
 * types, in plain string order. The compiler prints an inferred union in the order it created the
 * members' types, and an inferred object type (a `Pick` of props) in the order it met them, which
 * differ between machines; neither order says anything. Interfaces are left as they are written.
 */
export function canonicalDeclaration(text) {
  const source = ts.createSourceFile('contract.d.ts', text, ts.ScriptTarget.Latest, true)
  const printed = (node) => plainPrinter.printNode(ts.EmitHint.Unspecified, node, source)
  const inOrder = (nodes) =>
    nodes
      .map((node) => ({ node, key: printed(node) }))
      .sort((a, b) => byCodeUnit(a.key, b.key))
      .map(({ node }) => node)
  const sortTypes = (context) => {
    const { factory } = context
    const visit = (node) => {
      const visited = ts.visitEachChild(node, visit, context)
      if (ts.isUnionTypeNode(visited)) {
        return factory.updateUnionTypeNode(visited, factory.createNodeArray(inOrder(visited.types)))
      }
      if (ts.isTypeLiteralNode(visited)) {
        // Only properties move: the order of call signatures picks an overload.
        const properties = inOrder(visited.members.filter(ts.isPropertySignature))
        const members = visited.members.map((member) =>
          ts.isPropertySignature(member) ? properties.shift() : member,
        )
        return factory.updateTypeLiteralNode(visited, factory.createNodeArray(members))
      }
      return visited
    }
    return (file) => ts.visitNode(file, visit)
  }
  const [sorted] = ts.transform(source, [sortTypes]).transformed
  return plainPrinter.printFile(sorted).trim()
}

/** The vendor packages under the kit's types, by name, with their versions. */
function vendorVersions(kitDir, typePaths) {
  const versions = {}
  for (const [specifier, file] of Object.entries(typePaths)) {
    if (specifier.startsWith(OWNED)) continue
    const parts = file.split('/')
    const at = parts.lastIndexOf('node_modules')
    if (at < 0) continue
    const name = parts[at + 1].startsWith('@')
      ? parts.slice(at + 1, at + 3).join('/')
      : parts[at + 1]
    const manifest = join(kitDir, ...parts.slice(0, at + 1), ...name.split('/'), 'package.json')
    versions[name] = JSON.parse(readFileSync(manifest, 'utf8')).version
  }
  return versions
}

/**
 * The contract of the kit at `kitDir`: `{ apiVersion, vendors, served, modules, types }`, every
 * declaration printed without comments on its own.
 */
export function readContract(kitAt) {
  const kitDir = resolve(kitAt)
  const kit = JSON.parse(readFileSync(join(kitDir, 'kit.json'), 'utf8'))
  const owned = Object.entries(kit.typePaths)
    .filter(([specifier]) => specifier.startsWith(OWNED))
    .sort(([a], [b]) => byCodeUnit(a, b))
  const program = ts.createProgram({
    rootNames: owned.map(([, file]) => join(kitDir, file)),
    options: {
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      types: [],
      typeRoots: [join(kitDir, kit.authoring.typeRoots)],
      paths: Object.fromEntries(
        Object.entries(kit.typePaths).map(([specifier, file]) => [specifier, [join(kitDir, file)]]),
      ),
    },
  })
  const checker = program.getTypeChecker()
  const printer = ts.createPrinter({ removeComments: true })
  const ownedFile = (file) =>
    file.includes(`${sep}node_modules${sep}@localixai${sep}`) ||
    relative(kitDir, file).startsWith(join('types', 'kit'))
  const resolved = (symbol) =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const print = (declaration) => {
    const node = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration
    return canonicalDeclaration(
      printer.printNode(ts.EmitHint.Unspecified, node, declaration.getSourceFile()),
    )
  }

  /** Public symbols by identity, so a type a declaration names is printed once, where it is public. */
  const publicSymbols = new Set()
  const modules = {}
  const inKit = (node) => !relative(kitDir, node.getSourceFile().fileName).startsWith('..')
  /** Exports a mini app would see as `any`: declared nowhere in the kit. */
  const missing = []
  for (const [specifier, file] of owned) {
    const source = program.getSourceFile(join(kitDir, file))
    const module = source && checker.getSymbolAtLocation(source)
    const exports = {}
    for (const symbol of module ? checker.getExportsOfModule(module) : []) {
      const target = resolved(symbol)
      publicSymbols.add(target)
      const declarations = target.declarations ?? []
      if (!declarations.length || !declarations.every(inKit)) {
        missing.push(`${specifier}: ${symbol.name}`)
        continue
      }
      exports[symbol.name] = [...new Set(declarations.map(print))].join('\n')
    }
    modules[specifier] = exports
  }
  if (missing.length) {
    throw new Error(
      `The kit at ${kitDir} leaves out the declarations of:\n${missing.map((name) => `  - ${name}`).join('\n')}`,
    )
  }

  /** Localix types the public declarations name without exporting them: part of the contract too. */
  const types = {}
  const queue = []
  const visit = (node) => {
    const name = ts.isTypeReferenceNode(node)
      ? node.typeName
      : ts.isExpressionWithTypeArguments(node)
        ? node.expression
        : ts.isTypeQueryNode(node)
          ? node.exprName
          : undefined
    const symbol = name && checker.getSymbolAtLocation(name)
    if (symbol) queue.push(resolved(symbol))
    ts.forEachChild(node, visit)
  }
  for (const symbol of publicSymbols) for (const node of symbol.declarations ?? []) visit(node)
  const seen = new Set(publicSymbols)
  while (queue.length) {
    const symbol = queue.shift()
    if (seen.has(symbol)) continue
    seen.add(symbol)
    const declarations = (symbol.declarations ?? []).filter((node) =>
      ownedFile(node.getSourceFile().fileName),
    )
    if (!declarations.length) continue
    const where = relative(kitDir, declarations[0].getSourceFile().fileName).split(sep).join('/')
    types[`${where.replace(/^types\/(node_modules\/)?/u, '')}#${symbol.name}`] = [
      ...new Set(declarations.map(print)),
    ].join('\n')
    for (const node of declarations) visit(node)
  }

  const served = {
    ui: Object.fromEntries(
      Object.entries(kit.uiSharedExports)
        .map(([specifier, names]) => [specifier, [...names].sort(byCodeUnit)])
        .sort(([a], [b]) => byCodeUnit(a, b)),
    ),
    backend: [...kit.authoring.backendSharedModules].sort(byCodeUnit),
  }
  return {
    apiVersion: kit.apiVersion,
    vendors: vendorVersions(kitDir, kit.typePaths),
    served,
    modules,
    types: Object.fromEntries(Object.entries(types).sort(([a], [b]) => byCodeUnit(a, b))),
  }
}

const fence = (text) => ['```ts', text, '```'].join('\n')

/** The contract as the committed Markdown: one heading per module, export and reached type. */
export function renderContract(contract) {
  const lines = [
    '# Mini app API',
    '',
    '<!-- Generated by `bun run mini-app-contract --write` from the mini app kit. Do not edit. -->',
    '',
    'What a mini app may rely on from Localix. A change here changes every mini app: removing or',
    'changing anything below needs a new `MINI_APP_API_VERSION`.',
    '',
    `apiVersion: ${contract.apiVersion}`,
    '',
    '## Vendor packages',
    '',
    ...Object.entries(contract.vendors)
      .sort(([a], [b]) => byCodeUnit(a, b))
      .map(([name, version]) => `- ${name} ${version}`),
    '',
    '## Served to a mini app backend',
    '',
    ...contract.served.backend.map((specifier) => `- ${specifier}`),
    '',
    '## Served to a mini app UI',
    '',
    ...Object.entries(contract.served.ui).map(
      ([specifier, names]) => `- ${specifier}: ${names.join(', ') || '(none)'}`,
    ),
    '',
  ]
  for (const [specifier, exports] of Object.entries(contract.modules)) {
    lines.push(`## module ${specifier}`, '')
    for (const [name, text] of Object.entries(exports).sort(([a], [b]) => byCodeUnit(a, b))) {
      lines.push(`### ${name}`, '', fence(text), '')
    }
  }
  lines.push('## Types the modules name', '')
  for (const [key, text] of Object.entries(contract.types)) {
    lines.push(`### ${key}`, '', fence(text), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
