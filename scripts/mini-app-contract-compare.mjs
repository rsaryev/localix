// What changed between the committed mini app contract and the one a kit was staged with, and
// whether that change breaks a mini app built against the committed one (`mini-app-contract.mjs`).
//
// It reads declarations, not types, so it judges what a declaration says: a module, an export, a
// served name or a lent package taken away, a property removed or made required, an argument a
// function now requires, a module served for the first time (an app that imports it fails on an
// older Localix, which only the apiVersion lets that Localix say). Everything else that moved is
// listed for the review the committed diff gets.
import ts from '@localixai/mini-app-kit-compiler'

const SECTION = /^## (.+)$/u
const ENTRY = /^### (.+)$/u

/** The committed Markdown back into `{ apiVersion, vendors, served, modules, types }`. */
export function parseContract(text) {
  const contract = {
    apiVersion: 0,
    vendors: {},
    served: { backend: [], ui: {} },
    modules: {},
    types: {},
  }
  const lines = text.split('\n')
  let section = ''
  let entries
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]
    const version = /^apiVersion: (\d+)$/u.exec(line)
    if (version) contract.apiVersion = Number(version[1])
    const heading = SECTION.exec(line)
    if (heading) {
      section = heading[1]
      entries = section.startsWith('module ')
        ? (contract.modules[section.slice('module '.length)] = {})
        : section === 'Types the modules name'
          ? contract.types
          : undefined
      continue
    }
    const entry = ENTRY.exec(line)
    if (entry && entries) {
      const start = lines.indexOf('```ts', at) + 1
      const end = lines.indexOf('```', start)
      entries[entry[1]] = lines.slice(start, end).join('\n')
      at = end
      continue
    }
    const item = /^- (.+)$/u.exec(line)?.[1]
    if (!item) continue
    if (section === 'Vendor packages') {
      const space = item.lastIndexOf(' ')
      contract.vendors[item.slice(0, space)] = item.slice(space + 1)
    } else if (section === 'Served to a mini app backend') {
      contract.served.backend.push(item)
    } else if (section === 'Served to a mini app UI') {
      const colon = item.indexOf(': ')
      const names = item.slice(colon + 2)
      contract.served.ui[item.slice(0, colon)] = names === '(none)' ? [] : names.split(', ')
    }
  }
  return contract
}

/**
 * The properties a declaration names (`props.size`, by the path of names leading to them) and
 * whether each is optional; and the arguments of the function it declares, if it declares one.
 */
function shapeOf(text) {
  const source = ts.createSourceFile('contract.d.ts', text, ts.ScriptTarget.Latest, true)
  const properties = new Map()
  const walk = (node, path) => {
    if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
      const at = [...path, node.name.getText(source)]
      // A path the members of a union both name is optional when any of them leaves it out, so
      // the order the union lists them in does not decide.
      const key = at.join('.')
      properties.set(key, Boolean(properties.get(key)) || Boolean(node.questionToken))
      if (node.type) walk(node.type, at)
      return
    }
    if (ts.isParameter(node)) {
      if (node.type) walk(node.type, [...path, node.name.getText(source)])
      return
    }
    ts.forEachChild(node, (child) => walk(child, path))
  }
  walk(source, [])
  const statement = source.statements[0]
  const declared =
    statement && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.type
      : statement
  const parameters = new Map(
    (declared && (ts.isFunctionDeclaration(declared) || ts.isFunctionTypeNode(declared))
      ? declared.parameters
      : []
    ).map((parameter) => [
      parameter.name.getText(source),
      Boolean(parameter.questionToken || parameter.initializer || parameter.dotDotDotToken),
    ]),
  )
  return { properties, parameters }
}

/** How `before` became `after`, judged for a mini app that relies on `before` (`label` names it). */
function declarationBreaks(label, before, after) {
  const was = shapeOf(before)
  const now = shapeOf(after)
  const breaks = []
  for (const [path, optional] of was.properties) {
    if (!now.properties.has(path)) breaks.push(`${label} loses ${path}`)
    else if (optional && !now.properties.get(path)) breaks.push(`${label}: ${path} is now required`)
  }
  for (const [name, optional] of now.parameters) {
    if (!optional && was.parameters.get(name) !== false)
      breaks.push(`${label} now requires ${name}`)
  }
  return breaks
}

/** The major part of a version, the minor one below 1.0, where semver puts its breaks. */
const majorOf = (version) => {
  const [major, minor] = version.split('.')
  return major === '0' ? `0.${minor}` : major
}

/** `{ breaking, changes }`: what in `after` breaks a mini app built against `before`, and the rest. */
export function compareContracts(before, after) {
  const breaking = []
  const changes = []
  for (const [name, version] of Object.entries(before.vendors)) {
    const next = after.vendors[name]
    if (next === undefined) breaking.push(`${name} is no longer lent`)
    else if (majorOf(next) !== majorOf(version))
      breaking.push(`${name} moves from ${version} to ${next}`)
    else if (next !== version) changes.push(`${name} moves from ${version} to ${next}`)
  }
  for (const specifier of before.served.backend) {
    if (!after.served.backend.includes(specifier))
      breaking.push(`the backend host no longer serves ${specifier}`)
  }
  for (const specifier of after.served.backend) {
    if (!before.served.backend.includes(specifier))
      breaking.push(`the backend host serves ${specifier} for the first time`)
  }
  for (const [specifier, names] of Object.entries(before.served.ui)) {
    const next = after.served.ui[specifier]
    if (!next) breaking.push(`the UI host no longer serves ${specifier}`)
    else
      for (const name of names)
        if (!next.includes(name))
          breaking.push(`the UI host no longer serves ${name} from ${specifier}`)
  }
  for (const [specifier, names] of Object.entries(after.served.ui)) {
    const was = before.served.ui[specifier]
    if (!was) breaking.push(`the UI host serves ${specifier} for the first time`)
    else
      for (const name of names)
        if (!was.includes(name)) changes.push(`the UI host serves ${name} from ${specifier}`)
  }
  for (const [specifier, exports] of Object.entries(before.modules)) {
    const next = after.modules[specifier]
    if (!next) {
      breaking.push(`${specifier} is gone`)
      continue
    }
    for (const [name, text] of Object.entries(exports)) {
      const label = `${specifier}: ${name}`
      if (next[name] === undefined) breaking.push(`${label} is gone`)
      else if (next[name] !== text) {
        const breaks = declarationBreaks(label, text, next[name])
        if (breaks.length) breaking.push(...breaks)
        else changes.push(`${label} changed`)
      }
    }
    for (const name of Object.keys(next))
      if (exports[name] === undefined) changes.push(`${specifier}: ${name} is new`)
  }
  for (const specifier of Object.keys(after.modules))
    if (!before.modules[specifier]) changes.push(`${specifier} is new`)
  // A type a module names but does not export is reached only through what does: losing it is a
  // change of those declarations, judged there; what it says is judged here.
  for (const [key, text] of Object.entries(before.types)) {
    const next = after.types[key]
    if (next === undefined) changes.push(`${key} is no longer named`)
    else if (next !== text) {
      const breaks = declarationBreaks(key, text, next)
      if (breaks.length) breaking.push(...breaks)
      else changes.push(`${key} changed`)
    }
  }
  for (const key of Object.keys(after.types))
    if (before.types[key] === undefined) changes.push(`${key} is newly named`)
  return { breaking, changes }
}

/**
 * Whether the staged contract `current` may stand for the `committed` one: `ok` when it is the
 * same, or when it was asked to be written (`write`) and breaks nothing, or breaks something under
 * a newer apiVersion. A break never passes on the same apiVersion, written or not.
 */
export function contractVerdict(committed, current, { write }) {
  if (committed === current) return { ok: true, write: false, breaking: [], changes: [] }
  const before = parseContract(committed)
  const after = parseContract(current)
  const { breaking, changes } = compareContracts(before, after)
  if (breaking.length && after.apiVersion <= before.apiVersion)
    return { ok: false, write: false, breaking, changes }
  return { ok: write, write, breaking, changes }
}
