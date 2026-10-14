import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { forEachChild, isNode, parseSource, type AstNode } from './oxc-ast'

/**
 * The JSX reader every surface contract shares — the kit's own and the host's. The parser and the
 * walk live in `./oxc-ast`; this file is only the JSX vocabulary on top of them.
 */

export interface WorkspaceTsxSource {
  path: string
  source: string
}

export interface JsxElementContract {
  line: number
  stringAttribute(name: string): string | undefined
  hasDescendant(tagName: string): boolean
  descendantCount(tagName: string): number
}

export interface JsxAttributeElementContract {
  line: number
  tagName: string
  hasAttribute(name: string): boolean
  stringAttribute(name: string): string | undefined
}

/**
 * The kit package root. The kit's own contracts read only below it: a kit test that walked the
 * app would make the kit's suite depend on which host happens to sit next to it, so the product-
 * wide halves of these rules live with the host and call {@link tsxSourcesUnder} with its roots.
 */
const KIT_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const sourcesByRoots = new Map<string, Promise<WorkspaceTsxSource[]>>()

/** Every kit TSX source that can introduce a UI surface, as `src/<category>/<file>.tsx`. */
export function kitTsxSources(): Promise<WorkspaceTsxSource[]> {
  return tsxSourcesUnder(KIT_ROOT, ['src'])
}

/**
 * Every TSX source under `sourceRoots` (relative to `workspaceRoot`) that can introduce a UI
 * surface — tests and stories excluded. Paths come back relative to `workspaceRoot`, so a failure
 * names the file the way the caller's allowlist does. One read per root set per process.
 */
export function tsxSourcesUnder(
  workspaceRoot: string,
  sourceRoots: readonly string[],
): Promise<WorkspaceTsxSource[]> {
  const key = [path.resolve(workspaceRoot), ...sourceRoots].join('\0')
  let sources = sourcesByRoots.get(key)
  if (!sources) {
    sources = loadTsxSources(workspaceRoot, sourceRoots)
    sourcesByRoots.set(key, sources)
  }
  return sources
}

async function loadTsxSources(
  workspaceRoot: string,
  sourceRoots: readonly string[],
): Promise<WorkspaceTsxSource[]> {
  const paths: string[] = []
  for (const sourceRoot of sourceRoots) {
    const glob = new Bun.Glob('**/*.tsx')
    for await (const relative of glob.scan({
      cwd: path.join(workspaceRoot, sourceRoot),
      onlyFiles: true,
    })) {
      if (!relative.includes('.test.') && !relative.includes('.stories.')) {
        paths.push(`${sourceRoot}/${relative}`)
      }
    }
  }

  return Promise.all(
    paths.sort().map(async (sourcePath) => ({
      path: sourcePath,
      source: await Bun.file(path.join(workspaceRoot, sourcePath)).text(),
    })),
  )
}

/**
 * `<Foo>`, `<Foo.Bar>`, `<foo:bar>` — written the way the source writes it, so a caller can compare
 * against the tag name it is looking for without knowing which of the three shapes oxc produced.
 */
function tagNameOf(name: AstNode | undefined): string {
  if (!name) return ''
  if (name.type === 'JSXIdentifier') return String(name.name)
  if (name.type === 'JSXMemberExpression') {
    return `${tagNameOf(name.object as AstNode)}.${tagNameOf(name.property as AstNode)}`
  }
  if (name.type === 'JSXNamespacedName') {
    return `${tagNameOf(name.namespace as AstNode)}:${tagNameOf(name.name as AstNode)}`
  }
  return ''
}

/** oxc keeps a self-closing element as a `JSXElement` whose opening element says so. */
function openingOf(element: AstNode): AstNode | undefined {
  return isNode(element.openingElement) ? element.openingElement : undefined
}

/**
 * `<Foo />` — no subtree, by construction.
 *
 * It matters to {@link jsxElementContracts}, whose whole question is "what does this element
 * CONTAIN". A forwarding wrapper (`autocomplete.tsx` re-exports `<PopoverContent … {...props} />`)
 * writes its regions at the CALL SITE, so judging the wrapper on its own empty body reports a
 * violation that no caller could fix. The TypeScript AST gave this for free — a self-closing tag
 * was a different node type there, and the old walker only matched `JsxElement` — so preserving
 * the behaviour here is restoring the contract, not narrowing it.
 *
 * {@link jsxElementsWithStringAttribute} deliberately keeps them: it asks what an element DECLARES,
 * which a self-closing tag answers as well as any other, and the old code matched both there too.
 */
function isSelfClosing(element: AstNode): boolean {
  return openingOf(element)?.selfClosing === true
}

function elementTagName(element: AstNode): string {
  return tagNameOf(openingOf(element)?.name as AstNode | undefined)
}

function attributesOf(element: AstNode): AstNode[] {
  const attributes = openingOf(element)?.attributes
  return Array.isArray(attributes) ? attributes.filter(isNode) : []
}

/** A JSX attribute written as a plain string — `aria-label="Files"`, never `{expr}`. */
function stringAttributeOf(element: AstNode, name: string): string | undefined {
  for (const attribute of attributesOf(element)) {
    if (attribute.type !== 'JSXAttribute') continue
    if (tagNameOf(attribute.name as AstNode) !== name) continue
    const value = attribute.value
    if (isNode(value) && value.type === 'Literal' && typeof value.value === 'string') {
      return value.value
    }
    return undefined
  }
  return undefined
}

function hasAttributeNamed(element: AstNode, name: string): boolean {
  return attributesOf(element).some(
    (attribute) =>
      attribute.type === 'JSXAttribute' && tagNameOf(attribute.name as AstNode) === name,
  )
}

/**
 * Inspect each JSX element independently, following locally declared React
 * components so a semantic region may be factored without making the guard blind.
 */
export function jsxElementContracts(
  sourcePath: string,
  source: string,
  rootTagName: string,
): JsxElementContract[] {
  const { program, lineAt } = parseSource(sourcePath, source)
  const localComponents = new Map<string, AstNode>()

  const collectLocalComponents = (node: AstNode) => {
    if (node.type === 'FunctionDeclaration' && isNode(node.id)) {
      localComponents.set(String(node.id.name), node)
    } else if (
      node.type === 'VariableDeclarator' &&
      isNode(node.id) &&
      node.id.type === 'Identifier' &&
      isNode(node.init) &&
      (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')
    ) {
      localComponents.set(String(node.id.name), node.init)
    }
    forEachChild(node, collectLocalComponents)
  }
  forEachChild(program, collectLocalComponents)

  const countDescendants = (root: AstNode, targetTagName: string) => {
    let count = 0
    const resolvingComponents = new Set<string>()
    const visit = (node: AstNode) => {
      if (node.type === 'JSXElement') {
        const tagName = elementTagName(node)
        if (tagName === targetTagName) count += 1
        // Another instance of the ROOT tag begins its own contract; this one stops here.
        if (node !== root && tagName === rootTagName) return
        const component = localComponents.get(tagName)
        if (component && !resolvingComponents.has(tagName)) {
          resolvingComponents.add(tagName)
          visit(component)
          resolvingComponents.delete(tagName)
        }
      }
      forEachChild(node, visit)
    }
    const children = Array.isArray(root.children) ? root.children.filter(isNode) : []
    children.forEach(visit)
    return count
  }

  const contracts: JsxElementContract[] = []
  const visit = (node: AstNode) => {
    if (
      node.type === 'JSXElement' &&
      !isSelfClosing(node) &&
      elementTagName(node) === rootTagName
    ) {
      contracts.push({
        line: lineAt(Number(node.start ?? 0)),
        stringAttribute: (name) => stringAttributeOf(node, name),
        hasDescendant: (tagName) => countDescendants(node, tagName) > 0,
        descendantCount: (tagName) => countDescendants(node, tagName),
      })
    }
    forEachChild(node, visit)
  }
  forEachChild(program, visit)
  return contracts
}

/** Every JSX element the predicate accepts, self-closing tags included. */
function jsxElementsWhere(
  sourcePath: string,
  source: string,
  accept: (element: AstNode) => boolean,
): JsxAttributeElementContract[] {
  const { program, lineAt } = parseSource(sourcePath, source)
  const contracts: JsxAttributeElementContract[] = []

  const visit = (node: AstNode) => {
    if (node.type === 'JSXElement' && accept(node)) {
      contracts.push({
        line: lineAt(Number(node.start ?? 0)),
        tagName: elementTagName(node),
        hasAttribute: (name) => hasAttributeNamed(node, name),
        stringAttribute: (name) => stringAttributeOf(node, name),
      })
    }
    forEachChild(node, visit)
  }
  forEachChild(program, visit)
  return contracts
}

/** Every JSX element carrying one exact static string attribute. */
export function jsxElementsWithStringAttribute(
  sourcePath: string,
  source: string,
  attributeName: string,
  attributeValue: string,
): JsxAttributeElementContract[] {
  return jsxElementsWhere(
    sourcePath,
    source,
    (element) => stringAttributeOf(element, attributeName) === attributeValue,
  )
}

/** Every JSX element written with this exact tag — `<button>`, `<Dialog>`, `<Foo.Bar>`. */
export function jsxElementsNamed(
  sourcePath: string,
  source: string,
  tagName: string,
): JsxAttributeElementContract[] {
  return jsxElementsWhere(sourcePath, source, (element) => elementTagName(element) === tagName)
}
