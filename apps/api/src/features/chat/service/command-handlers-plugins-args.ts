import type { SessionRecord } from '../repository'

/**
 * `--accept-command <sha256>`: the person accepts the `headersHelper` command an install or update
 * showed them (plugins/cli-reference, `plugin install`); the flag leaves the other arguments.
 */
export function takeAcceptCommand(args: string[]): { args: string[]; accepted?: string } {
  const at = args.indexOf('--accept-command')
  if (at < 0) return { args }
  const accepted = args[at + 1]
  return {
    args: args.filter((_arg, i) => i !== at && i !== at + 1),
    ...(accepted ? { accepted } : {}),
  }
}

/**
 * Claude Code's `--scope user|project|local`. Localix installs for everyone (user) or for this
 * project; `local` (only me, in this repo) is nearest to this project.
 */
export function takeScope(args: readonly string[]): {
  args: string[]
  project: boolean
  /** The scope named, when one was: `user` is everyone, the rest this project. */
  scope?: 'user' | 'project'
  /** `--scope` named something else (or nothing): acting on a guess would change the wrong scope. */
  invalid?: true
} {
  const at = args.findIndex((arg) => arg === '--scope' || arg === '-s')
  if (at < 0) return { args: [...args], project: false }
  const value = args[at + 1]?.toLowerCase()
  const project = value === 'project' || value === 'local'
  if (!project && value !== 'user') return { args: [], project: false, invalid: true }
  return {
    args: args.filter((_, i) => i !== at && i !== at + 1),
    project,
    ...(project
      ? { scope: 'project' as const }
      : value === 'user'
        ? { scope: 'user' as const }
        : {}),
  }
}

export const SCOPE_USAGE = 'The scope is `--scope user|project|local`; nothing was changed.'

/** The project a verb acts on: `--scope user` names none, otherwise this chat's project. */
export function scopedProjectId(session: SessionRecord, scope: 'user' | 'project' | undefined) {
  return scope === 'user' ? null : (session.projectId ?? null)
}
