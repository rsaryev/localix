import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Where Claude Code keeps a person's own configuration: `CLAUDE_CONFIG_DIR` when it is set, else
 * `~/.claude` (env-vars.md, `CLAUDE_CONFIG_DIR`: "All settings, session history, and plugins are
 * stored under this path"). Every reader of Claude Code's user files resolves through here, so a
 * person who runs `CLAUDE_CONFIG_DIR=~/.claude-work claude` gets the same plugins, settings and
 * history in Localix.
 *
 * The rule is the kit's (`configDirectoryOf`, `globalConfigFileOf`; `kit/settings/config-dir.test.ts`
 * holds the two readings equal): an empty value is unset, any other is taken as written, neither
 * trimmed nor `~`-expanded (env-vars.md, "In settings files": "shorthand such as `~` or `$HOME`
 * stays as typed"). This module cannot call the kit: the plugin boundary imports it (rule A6).
 * `resolve` only makes a relative value absolute against the process, as a file call would.
 */
const configuredDir = (env: Record<string, string | undefined>): string | undefined =>
  env.CLAUDE_CONFIG_DIR || undefined

export function claudeConfigDir(
  homeDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = configuredDir(env)
  return configured === undefined ? join(homeDir, '.claude') : resolve(configured)
}

/**
 * Claude Code's own state file (`~/.claude.json`: MCP servers, per-project trust and approvals).
 * With `CLAUDE_CONFIG_DIR` set it lives inside that directory.
 */
export function claudeStateFile(
  homeDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return join(
    configuredDir(env) === undefined ? homeDir : claudeConfigDir(homeDir, env),
    '.claude.json',
  )
}

/**
 * The home Claude Code's files are read from: `HOME`, as Claude Code resolves `~`, else the OS
 * account's home. Read from the environment rather than once per process, so a test that gives
 * the process a home of its own never reads the developer's Claude Code configuration.
 */
export function claudeCodeHome(env: Record<string, string | undefined> = process.env): string {
  return env.HOME?.trim() || homedir()
}
