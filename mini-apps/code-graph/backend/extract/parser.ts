import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Language, Parser } from '@vscode/tree-sitter-wasm'
import coreWasm from '@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm' with { type: 'file' }
import goWasm from '@vscode/tree-sitter-wasm/wasm/tree-sitter-go.wasm' with { type: 'file' }
import javascriptWasm from '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm' with { type: 'file' }
import pythonWasm from '@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm' with { type: 'file' }
import tsxWasm from '@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm' with { type: 'file' }
import typescriptWasm from '@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm' with { type: 'file' }
import type { LanguageId } from '../../shared/model'

/**
 * Tree-sitter, as WebAssembly, loaded once per process.
 *
 * WASM rather than the native bindings because the mini app runs on every machine the app ships to
 * without a compiler: a native `.node` grammar is one build per platform and architecture, and a
 * a native build broke on arm64 under a new Node. The grammars come from the prebuilt
 * `@vscode/tree-sitter-wasm` set, so their ABI matches the runtime they ship with.
 *
 * Each `.wasm` is a file import: the bundler copies it next to the bundle and gives back a path
 * relative to THIS module, which is why every path is resolved against `import.meta.url`.
 */
const here = dirname(fileURLToPath(import.meta.url))
const asset = (path: string) => resolve(here, path)

const GRAMMARS: Record<LanguageId, string> = {
  typescript: typescriptWasm,
  tsx: tsxWasm,
  javascript: javascriptWasm,
  python: pythonWasm,
  go: goWasm,
}

let runtime: Promise<void> | null = null
const languages = new Map<LanguageId, Promise<Language>>()

function initRuntime(): Promise<void> {
  runtime ??= Parser.init({ locateFile: () => asset(coreWasm) }).catch((error: unknown) => {
    runtime = null
    throw error
  })
  return runtime
}

function loadLanguage(id: LanguageId): Promise<Language> {
  let loading = languages.get(id)
  if (!loading) {
    loading = initRuntime()
      .then(() => Language.load(asset(GRAMMARS[id])))
      .catch((error: unknown) => {
        languages.delete(id)
        throw error
      })
    languages.set(id, loading)
  }
  return loading
}

/** A parser per language, reused: creating one allocates inside the WASM heap. */
const parsers = new Map<LanguageId, Parser>()

export async function parserFor(id: LanguageId): Promise<Parser> {
  const known = parsers.get(id)
  if (known) return known
  const language = await loadLanguage(id)
  const parser = parsers.get(id) ?? new Parser()
  parser.setLanguage(language)
  parsers.set(id, parser)
  return parser
}
