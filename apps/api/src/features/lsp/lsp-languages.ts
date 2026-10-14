/** File-extension → LSP `languageId` map used when opening a document. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.html': 'html',
  '.lua': 'lua',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.zig': 'zig',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.dockerfile': 'dockerfile',
}

/** True when the basename is a Dockerfile (extension-less or a variant). */
export function isDockerfileName(base: string): boolean {
  const b = base.toLowerCase()
  return b === 'dockerfile' || b.startsWith('dockerfile.') || b.endsWith('.dockerfile')
}

/**
 * Resolve the LSP `languageId` for a file path: filename-special-cases first
 * (Dockerfile has no extension), then the extension map, else `plaintext`.
 */
export function languageIdForPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  if (isDockerfileName(base)) return 'dockerfile'
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : ''
  return EXTENSION_TO_LANGUAGE[ext] ?? 'plaintext'
}
