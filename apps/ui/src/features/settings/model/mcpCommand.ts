/** Pure parsing helpers for the MCP "command" install mode (see mcpCommand.test.ts). The line is
 *  split by the API's own splitter so the form and the server import read one command the same. */
export { splitCommandLine } from '@localixai/api/mcp-command-line'

/** Slug a package/command into a default server name. */
export function slugFromCommand(tokens: string[]): string {
  const pkg =
    tokens.find((t) => !t.startsWith('-') && t !== 'npx' && t !== 'uvx' && t !== '-y') ??
    tokens[0] ??
    'server'
  const base = pkg.split('/').pop() ?? pkg
  return (
    base
      .replace(/[^a-z0-9_-]/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'server'
  )
}
