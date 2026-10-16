/** Language ids supported by Monaco and exposed by the editor status bar. */
export const SUPPORTED_LANGUAGE_IDS = [
  'text',
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'html',
  'xml',
  'css',
  'scss',
  'python',
  'markdown',
  'rust',
  'go',
  'c',
  'cpp',
  'java',
  'ruby',
  'bash',
  'dockerfile',
  'yaml',
  'sql',
  'toml',
] as const

export type SupportedLanguageId = (typeof SUPPORTED_LANGUAGE_IDS)[number]

/**
 * File extensions understood by the editor. Keeping this map constrained to the
 * status-bar language ids prevents path detection from returning a grammar that
 * the editor cannot expose (the old C/C++/Java/Ruby mismatch).
 */
const EXT_TO_LANG = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyw: 'python',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  'h++': 'cpp',
  ipp: 'cpp',
  tpp: 'cpp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  toml: 'toml',
} satisfies Record<string, SupportedLanguageId>

/** Infer a supported highlight language from a file path. */
export function languageFromPath(path: string | undefined): SupportedLanguageId {
  if (!path) return 'text'
  // Extension-less / by-name files: Dockerfile, Dockerfile.dev, api.dockerfile.
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile'))
    return 'dockerfile'
  const ext = base.split('.').pop() ?? ''
  return EXT_TO_LANG[ext as keyof typeof EXT_TO_LANG] ?? 'text'
}

/** Normalize app language ids to Monaco's registered ids. */
export function monacoLanguageId(language: string): string {
  switch (language) {
    case 'text':
      return 'plaintext'
    case 'tsx':
      return 'typescript'
    case 'jsx':
      return 'javascript'
    case 'bash':
    case 'shell':
      return 'shell'
    case 'toml':
      return 'ini'
    default:
      return language
  }
}
