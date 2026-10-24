import { join, resolve } from 'node:path'

/**
 * Where Claude Code keeps a person's own configuration: `CLAUDE_CONFIG_DIR` when it is set, else
 * `~/.claude` (env-vars.md, `CLAUDE_CONFIG_DIR`: "All settings, session history, and plugins are
 * stored under this path"). Every reader of Claude Code's user files resolves through here, so a
 * person who runs `CLAUDE_CONFIG_DIR=~/.claude-work claude` gets the same plugins, settings and
 * history in Localix.
 */
export function claudeConfigDir(
  homeDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim()
  if (!configured) return join(homeDir, '.claude')
  // A `~` the shell did not expand (a settings `env` block copies values as written).
  if (configured === '~' || configured.startsWith('~/')) return join(homeDir, configured.slice(1))
  return resolve(configured)
}

/**
 * Claude Code's own state file (`~/.claude.json`: MCP servers, per-project trust and approvals).
 * With `CLAUDE_CONFIG_DIR` set it lives inside that directory.
 */
export function claudeStateFile(
  homeDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return env.CLAUDE_CONFIG_DIR?.trim()
    ? join(claudeConfigDir(homeDir, env), '.claude.json')
    : join(homeDir, '.claude.json')
}
