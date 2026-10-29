// The host kit, declared by what its components ACCEPT, not only by their names.
//
// The kit's modules are host source that re-export host primitives, so staging declared each
// export as `any`. A mini app could pass anything — `<Button variant="bogus" size="huge">` checked
// clean — and the agent, told not to search the disk for sources, had no way to learn the props at
// all: a mini app hand-rolled `<button className="rounded border px-4 py-2">` in palette colours
// instead. This reads each export's real type from the host sources with the TypeScript compiler
// and writes it out SELF-CONTAINED, because the kit ships without the host tree:
//
// - a component's OWN props are printed; the element props it forwards are named by React's
//   attribute interface (`React.ButtonHTMLAttributes<HTMLButtonElement>`), not expanded;
// - a type the host declares is declared again in the same file;
// - React and lucide-react types are referenced from the declarations the kit already ships;
// - a type from anywhere else (Radix, cmdk, Monaco) is declared `any`, so no name ever dangles.
//
// Then every file is compiled on its own (`verifyKitDeclarations`), and one the compiler rejects
// falls back to the names-only declaration: the mini app check runs with `skipLibCheck`, so a
// broken kit type would not fail loudly — it would quietly become `any` in every mini app.
//
// The same pass writes the DIGEST — one line per core control — which the agent's instruction
// carries, so the agent is told props that exist.
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import ts from '@localixai/mini-app-kit-compiler'

const NODE_FLAGS =
  ts.NodeBuilderFlags.NoTruncation |
  ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope |
  ts.NodeBuilderFlags.IgnoreErrors
/** React's element-attribute interfaces, most specific first. */
const ELEMENT_ATTRIBUTES = [
  'ButtonHTMLAttributes',
  'InputHTMLAttributes',
  'TextareaHTMLAttributes',
  'SelectHTMLAttributes',
  'AnchorHTMLAttributes',
  'LabelHTMLAttributes',
  'FormHTMLAttributes',
  'ImgHTMLAttributes',
  'LiHTMLAttributes',
  'TableHTMLAttributes',
  'TdHTMLAttributes',
  'SVGAttributes',
  'HTMLAttributes',
]
/** Props a digest line leaves out: every component takes them, and they teach nothing. */
const DIGEST_SKIP = new Set(['className', 'children', 'style', 'asChild'])
const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  types: [],
}

const key = (name) => (/^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name))
const anyType = () => ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

/**
 * Where a declared symbol comes from, which decides how a kit file may name it. `host` is by
 * LOCATION — the host UI source and the workspace packages — not "outside node_modules": Monaco is
 * a workspace dependency symlinked from `vendor/`, and treating it as host inlined fifteen hundred
 * lines of an editor API into one kit module.
 */
function originOf(ctx, symbol) {
  const declaration = symbol?.declarations?.[0]
  if (!declaration) return 'global'
  const source = declaration.getSourceFile()
  if (ctx.program.isSourceFileDefaultLibrary(source)) return 'global'
  const file = source.fileName.split('\\').join('/')
  if (/\/typescript\/lib\/lib\.[^/]+\.d\.ts$/u.test(file)) return 'global'
  if (file.includes('/node_modules/@types/react/') || file.includes('/node_modules/csstype/'))
    return 'react'
  if (file.includes('/node_modules/lucide-react/')) return 'lucide'
  if (!file.includes('/node_modules/') && ctx.hostRoots.some((root) => file.startsWith(root)))
    return 'host'
  return 'foreign'
}

/** One kit module's declaration text, built as its exports are printed. */
function createModuleWriter(ctx) {
  const { checker } = ctx
  const printer = ts.createPrinter({ removeComments: true })
  const scratch = ts.createSourceFile(
    'kit.d.ts',
    '',
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.TS,
  )
  const lucide = new Set()
  const locals = new Map()
  const pending = []

  function record(symbol) {
    if (locals.has(symbol.name)) return
    locals.set(symbol.name, { symbol, origin: originOf(ctx, symbol) })
    pending.push(symbol.name)
  }

  /**
   * Rename every type reference by where its SYMBOL is declared — never by its name, which is
   * ambiguous: `MouseEvent<Element, MouseEvent>` is React's event over the DOM's.
   */
  const byOrigin = (context) => {
    const visit = (node) => {
      if (ts.isImportTypeNode(node)) return anyType()
      if (!ts.isTypeReferenceNode(node)) return ts.visitEachChild(node, visit, context)
      const args = node.typeArguments && ts.visitNodes(node.typeArguments, visit)
      if (ts.isQualifiedName(node.typeName)) {
        // `NodeJS.Timeout`, `editor.IEditorOptions`: a namespace the kit ships only for globals.
        const origin = originOf(ctx, node.typeName.right.symbol)
        return origin === 'global'
          ? ts.factory.createTypeReferenceNode(node.typeName, args)
          : anyType()
      }
      const symbol = node.typeName.symbol
      if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
        const origin = originOf(ctx, symbol)
        if (origin === 'react') {
          // Only a member of the React namespace is reachable as `React.X`. `@types/react` also
          // declares file-local helpers (`Booleanish`) that its own attribute types use; naming
          // one as `React.Booleanish` is a compile error, which demoted the whole module to a
          // names-only declaration.
          if (symbol.parent?.name !== 'React') return anyType()
          const name = ts.factory.createQualifiedName(
            ts.factory.createIdentifier('React'),
            ts.factory.createIdentifier(node.typeName.text),
          )
          return ts.factory.createTypeReferenceNode(name, args)
        }
        if (origin === 'lucide') lucide.add(node.typeName.text)
        else if (origin !== 'global') record(symbol)
      }
      return ts.factory.createTypeReferenceNode(node.typeName, args)
    }
    return (root) => ts.visitNode(root, visit)
  }

  /** A type as this file names it. */
  function print(type, flags = 0) {
    const node = checker.typeToTypeNode(type, undefined, NODE_FLAGS | flags)
    const [out] = ts.transform(node, [byOrigin]).transformed
    return printer.printNode(ts.EmitHint.Unspecified, out, scratch)
  }

  /**
   * A type's parameters as this file declares them. For a type declared `any`, each parameter
   * defaults to `any`: the source may reference the type bare (`Node`, meaning the package's own
   * defaults), and `type Node<NodeData, NodeType> = any` rejected every bare reference, so the
   * whole module fell back to names-only.
   */
  function typeParameters(symbol, namesOnly) {
    const declaration = symbol.declarations?.find((node) => node.typeParameters)
    if (!declaration) return ''
    const params = declaration.typeParameters.map((node) =>
      namesOnly ? `${node.name.text} = any` : node.getText(),
    )
    return `<${params.join(', ')}>`
  }

  /** The body of a named type from the host, or `any` for one from a package the kit lacks. */
  function declareLocal(entry, exported = false) {
    const { symbol, origin } = entry
    const lead = `${exported ? 'export ' : ''}type ${symbol.name}`
    if (origin !== 'host' || symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Enum)) {
      return `${lead}${typeParameters(symbol, true)} = any`
    }
    const declared = checker.getDeclaredTypeOfSymbol(symbol)
    const head = `${lead}${typeParameters(symbol, false)}`
    if (symbol.flags & ts.SymbolFlags.TypeAlias) {
      return `${head} = ${print(declared, ts.NodeBuilderFlags.InTypeAlias)}`
    }
    const members = checker.getPropertiesOfType(declared).map((property) => {
      const optional = property.flags & ts.SymbolFlags.Optional ? '?' : ''
      return `  ${key(property.name)}${optional}: ${print(checker.getTypeOfSymbol(property))}`
    })
    return `${head} = {\n${members.join('\n')}\n}`
  }

  function render(body) {
    // Declaring a local can reference more locals; drain until none is left undeclared.
    const declared = []
    while (pending.length) {
      const entry = locals.get(pending.shift())
      if (!entry.exported) declared.push(declareLocal(entry))
    }
    const imports = [
      "import type * as React from 'react'",
      lucide.size
        ? `import type { ${[...lucide].sort((a, b) => a.localeCompare(b)).join(', ')} } from 'lucide-react'`
        : '',
    ].filter(Boolean)
    return [...imports, '', ...declared, ...body, 'export {}', ''].join('\n')
  }

  return { print, locals, declareLocal, render }
}

/** Props split into what the component adds and the React element attributes it forwards. */
function splitProps(ctx, propsType, source) {
  const own = []
  const reactOwners = new Set()
  let ref = null
  for (const property of propsType.getApparentProperties()) {
    const fromReact = originOf(ctx, property) === 'react'
    const owner = property.declarations?.[0]?.parent?.name?.text
    if (fromReact && property.name === 'ref')
      ref = ctx.checker.getTypeOfSymbolAtLocation(property, source)
    else if (fromReact && owner?.endsWith('Attributes') && owner !== 'RefAttributes')
      reactOwners.add(owner)
    else own.push(property)
  }
  const base = ELEMENT_ATTRIBUTES.find((name) => reactOwners.has(name)) ?? null
  const hint = ref ? ctx.checker.typeToString(ref) : ''
  const element = /(HTML\w*Element|SVG\w*Element)/u.exec(hint)?.[1] ?? 'HTMLElement'
  return { own, base, element, hasRef: Boolean(ref) }
}

function componentDeclaration(ctx, writer, name, signature, source) {
  const { print } = writer
  const parameter = signature.getParameters()[0]
  const params = signature.getTypeParameters() ?? []
  const generics = params.length
    ? `<${params
        .map((param) => {
          const constraint = param.getConstraint()
          // A default kept: `<Canvas<MyNode>>` names one of two parameters.
          const fallback = ctx.checker.getDefaultFromTypeParameter(param)
          return `${param.symbol.name}${constraint ? ` extends ${print(constraint)}` : ''}${fallback ? ` = ${print(fallback)}` : ''}`
        })
        .join(', ')}>`
    : ''
  if (!parameter)
    return {
      text: `export declare const ${name}: () => React.ReactElement | null`,
      own: [],
      base: null,
    }
  const propsType = ctx.checker.getTypeOfSymbolAtLocation(parameter, source)
  const { own, base, element, hasRef } = splitProps(ctx, propsType, source)
  const members = own.map((property) => {
    const optional = property.flags & ts.SymbolFlags.Optional ? '?' : ''
    const raw = ctx.checker.getTypeOfSymbolAtLocation(property, source)
    const type = print(raw).replace(/ \| undefined$/u, '')
    // The digest spells a size or a variant out: `ChoiceControlSize` tells the agent nothing.
    return { name: property.name, optional, type, digest: literalUnion(raw) ?? type }
  })
  const parts = [`{ ${members.map((m) => `${key(m.name)}${m.optional}: ${m.type}`).join('; ')} }`]
  if (base) {
    const omitted = members.map((m) => JSON.stringify(m.name)).join(' | ')
    const forwarded =
      base === 'SVGAttributes' ? 'React.SVGAttributes<SVGElement>' : `React.${base}<${element}>`
    parts.push(omitted ? `Omit<${forwarded}, ${omitted}>` : forwarded)
  }
  if (hasRef) parts.push(`React.RefAttributes<${element}>`)
  return {
    text: `export declare const ${name}: ${generics}(props: ${parts.join(' & ')}) => React.ReactElement | null`,
    own: members,
    base,
    element,
  }
}

/** `"md" | "lg" | "xl"` for a union of literals (null and undefined dropped), else null. */
function literalUnion(type) {
  const members = type.isUnion() ? type.types : [type]
  const values = members.filter(
    (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
  )
  if (!values.length || !values.every((member) => member.isLiteral())) return null
  return values.map((member) => JSON.stringify(member.value)).join(' | ')
}

function digestLine(id, name, declaration) {
  const props = declaration.own
    .filter((member) => !DIGEST_SKIP.has(member.name))
    .map((member) => {
      const flat = member.digest.replace(/\s+/gu, ' ')
      const type = flat.length > 160 ? `${flat.slice(0, 157)}…` : flat
      return `${member.name}${member.optional}: ${type}`
    })
  if (declaration.own.some((member) => member.name === 'children')) props.push('children')
  const tag =
    declaration.base === 'SVGAttributes'
      ? 'svg'
      : declaration.element?.replace(/^HTML|Element$/gu, '').toLowerCase() || 'element'
  const forwarded = declaration.base ? ` + <${tag}> attributes` : ''
  return `@localixai/kit/${id} ${name}({ ${props.join('; ')} })${forwarded}`
}

/**
 * The symbol carrying a name's VALUE meaning, or null for a pure type. A name can be both at once
 * — the flow library's `Handle` is a component and a type alias — and such a merged re-export
 * resolves to a symbol that is still partly an alias: its flags say "type", and the component is
 * one more resolution away. Read by its flags alone, `Handle` was declared `type Handle = any`, and
 * a mini app's `<Handle>` failed with "only refers to a type".
 */
function valueMeaning(checker, symbol) {
  if (symbol.flags & ts.SymbolFlags.Value) return symbol
  if (!(symbol.flags & ts.SymbolFlags.Alias)) return null
  const target = checker.getAliasedSymbol(symbol)
  return target.flags & ts.SymbolFlags.Value ? target : null
}

function declareModule(ctx, file, id) {
  const { checker } = ctx
  const writer = createModuleWriter(ctx)
  const source = ctx.program.getSourceFile(file)
  const body = []
  const lines = new Map()
  for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const name = exported.name
    const value = valueMeaning(checker, symbol)
    // A pure type, or the type half of a merged name: declared first, so printing the value half
    // cannot declare the same name a second time as a local.
    if (!value || value !== symbol) {
      const entry = { symbol, origin: originOf(ctx, symbol), exported: true }
      writer.locals.set(symbol.name, entry)
      body.push(writer.declareLocal(entry, true))
      if (!value) continue
    }
    const type = checker.getTypeOfSymbolAtLocation(value, source)
    const signature = type.getCallSignatures()[0]
    if (signature && /^[A-Z]/u.test(name)) {
      const declaration = componentDeclaration(ctx, writer, name, signature, source)
      body.push(declaration.text)
      lines.set(name, digestLine(id, name, declaration))
    } else {
      // `typeof X` names a value this file never declares (an enum's object, say `Position`):
      // printed as is it references itself, and the whole module fell back to names-only.
      const printed = writer.print(type)
      body.push(`export declare const ${name}: ${/^typeof\b/u.test(printed) ? 'any' : printed}`)
    }
  }
  return {
    text: `// Generated from the host kit: what @localixai/kit/${id} exports, and what it accepts.\n${writer.render(body)}`,
    lines,
  }
}

/**
 * Declarations for every kit module (`id → d.ts text`) and a digest line for each `id:Export` in
 * `digest`, in that order. A module the compiler cannot describe is left out, for the caller's
 * name-only fallback: a kit that stages with a weaker type for one module beats one that does not
 * stage at all.
 */
export function declareKitModules({ repoRoot, kitDirs, digest, extra = [] }) {
  // `@localixai/kit/<id>` is a door of the kit package or a module the host lends; the id is the
  // file name in either directory (an id in both is refused by the registry's own test). `extra`
  // adds `[id, file]` pairs the directories do not hold (the host's test harness).
  const modules = [
    ...kitDirs.flatMap((kitDir) =>
      readdirSync(kitDir)
        .filter((file) => file.endsWith('.ts'))
        .map((file) => [basename(file, '.ts'), join(kitDir, file)]),
    ),
    ...extra,
  ]
  const files = modules.map(([, file]) => file)
  const ui = join(repoRoot, 'apps', 'ui')
  const program = ts.createProgram({
    rootNames: files,
    options: {
      ...COMPILER_OPTIONS,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      baseUrl: ui,
      paths: { '@/*': ['./src/*'] },
    },
  })
  const ctx = {
    program,
    checker: program.getTypeChecker(),
    hostRoots: [join(ui, 'src'), join(repoRoot, 'packages')].map((root) => `${root}/`),
  }
  const declarations = new Map()
  const lines = new Map()
  for (const [id, file] of modules) {
    try {
      const described = declareModule(ctx, file, id)
      declarations.set(id, described.text)
      for (const [name, line] of described.lines) lines.set(`${id}:${name}`, line)
    } catch {
      // Left to the caller's name-only fallback.
    }
  }
  return { declarations, lines, digest: digest.flatMap((entry) => lines.get(entry) ?? []) }
}

/**
 * The kit declaration files in `dir` the compiler rejects, checked with NOTHING skipped against
 * the kit's own type paths. Returned by file name (`button.d.ts`).
 */
export function verifyKitDeclarations({ dir, kitDir, typePaths }) {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => join(dir, file))
  const paths = Object.fromEntries(
    Object.entries(typePaths).map(([specifier, file]) => [specifier, [join(kitDir, file)]]),
  )
  const program = ts.createProgram({ rootNames: files, options: { ...COMPILER_OPTIONS, paths } })
  const rejected = new Set()
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const name = diagnostic.file?.fileName
    if (name?.startsWith(dir)) rejected.add(name.slice(dir.length + 1))
  }
  return rejected
}
