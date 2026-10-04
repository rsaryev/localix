import { allowPatternCoversCommands } from './permission-engine'
import { matches } from '../capabilities/rule'
import { isSecretPath } from './secret-paths'
import { splitCompoundCommand } from './tools/bash/bash-command-shape'

/**
 * What a "This session" / "Always" answer actually covers.
 *
 * The grant used to be keyed by TOOL NAME, and approving from a card showing `ls` covered
 * `rm -rf` for the rest of the session. It was then keyed by PROGRAM — which fixed shell calls
 * and broke every other subject: a file call's `command` is its path, so a card reading
 * `…/hooks/useTheme.ts` offered "Always for useTheme.ts commands", granted `read(useTheme.ts)`
 * and wrote the rule `useTheme.ts *` — neither of which can ever match an absolute path. The
 * button promised a permission and wrote nothing that worked.
 *
 * So the scope follows the SUBJECT the card shows:
 *
 *   command   `bash(git)`            the program, every command in the line
 *   path      `read(/abs/file)`      exactly that path
 *             `read(/abs/dir/*)`     anything inside a folder the person picked
 *   resource  `mcp(github/create)`   exactly that declared resource
 *   (none)    `agents`               the tool, for a call that names nothing (session only)
 *
 * The scope stays a plain string, because the grant set, the chip that lists it, the revoke
 * and the wire frame are all `string[]` — and each spelling reads as the rule for the same
 * thing reads in Settings. Matching is not reimplemented: a program defers to the rule
 * engine's command logic and a path to the rule glob, so a grant covers exactly what the
 * equivalent written rule would.
 */

/** One way to widen an approval, as offered on the card. Narrowest first in every list. */
export interface GrantOption {
  /** The session-grant key, and the id the answer names. */
  scope: string
  kind: 'program' | 'path' | 'folder' | 'resource' | 'tool'
  /** A short name for a picker segment: `git`, `useTheme.ts`, `src`. */
  label: string
  /** What it covers, as a phrase that completes "Won't ask again for …". */
  covers: string
  /** For a path or folder: the absolute path it names — what a breadcrumb segment matches. */
  target?: string
  /** The rule an `always` answer writes; absent when this breadth is session-only. */
  rule?: { action: string; resource: string }
}

/** The call a remembered scope is asked about — what the card showed, and as what. */
export interface GrantCall {
  toolName: string
  subject?: 'command' | 'path' | 'resource'
  /** The displayed subject; for a shell call, the command line itself. */
  command?: string
  /** The subject's items: the paths or resources the card listed. Empty for a bare tool. */
  targets?: readonly string[]
}

/**
 * Programs whose entire purpose is to run other code. A grant on one of these is a grant on
 * anything: `bash(bash)` would cover `bash -c '<whatever>'`. So a call whose program is one of
 * them gets NO grant at all — approving it approves that one call.
 *
 * `sudo`, `xargs`, `nice`, `nohup` and `timeout` are here for the same reason: they run
 * whatever follows them, so the granted prefix would describe the wrapper and say nothing
 * about the command that actually executes.
 */
const UNGRANTABLE_PROGRAMS = new Set([
  'bash',
  'sh',
  'zsh',
  'ksh',
  'dash',
  'fish',
  'csh',
  'tcsh',
  'python',
  'python2',
  'python3',
  'node',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
  'osascript',
  'eval',
  'exec',
  'source',
  'env',
  'sudo',
  'doas',
  'xargs',
  'nice',
  'nohup',
  'timeout',
  'watch',
  'ssh',
])

/** The program a command line starts with, or `undefined` when that is not knowable. */
function programOf(command: string): string | undefined {
  const segments = splitCompoundCommand(command)
  // `null` is substitution — the real program is hidden. A chained line has several programs
  // and no single one describes it, so it cannot be reduced to one grant either.
  if (segments?.length !== 1) return undefined
  const head = segments[0]!.trim().split(/\s+/u)[0]
  if (!head) return undefined
  // Strip a path so `/usr/bin/git` and `git` share a scope; strip nothing else, so a program
  // named with a shell metacharacter cannot smuggle one into the scope string.
  const base = head.split('/').pop()
  return base && /^[A-Za-z0-9._+-]+$/u.test(base) ? base : undefined
}

/** The program grant for a shell line, or nothing when the line cannot be reduced to one. */
export function programGrant(toolName: string, command: string): GrantOption | undefined {
  const program = programOf(command.trim())
  if (!program || UNGRANTABLE_PROGRAMS.has(program)) return undefined
  return {
    scope: `${toolName}(${program})`,
    kind: 'program',
    label: program,
    covers: `every ${program} command`,
    rule: { action: `tool:${toolName}`, resource: `${program} *` },
  }
}

/**
 * The grant for a call that names one declared resource, or for a call that names nothing.
 *
 * A bare tool gets a session grant and no rule: a wildcard resource would make a whole tool
 * unprompted forever by one click, which is not what a card about one call asked.
 */
export function resourceGrant(
  toolName: string,
  resources: readonly string[],
): GrantOption | undefined {
  if (resources.length === 0) {
    return { scope: toolName, kind: 'tool', label: toolName, covers: `every ${toolName} call` }
  }
  const [resource] = resources
  // One resource, spelled without the characters the scope or the glob would read as syntax.
  if (resources.length !== 1 || !resource || /[*()\n]/u.test(resource)) return undefined
  return {
    scope: `${toolName}(${resource})`,
    kind: 'resource',
    label: resource,
    covers: resource,
    rule: { action: `tool:${toolName}`, resource },
  }
}

/** `tool(inner)` → its halves; a bare tool name → no inner. Greedy, since a path may hold `)`. */
function parseScope(scope: string): { toolName: string; inner?: string } {
  const match = /^([^(]+)\((.+)\)$/su.exec(scope)
  return match ? { toolName: match[1]!, inner: match[2]! } : { toolName: scope }
}

/**
 * Does a remembered scope cover this call?
 *
 * Read against the SUBJECT of the new call, not of the old one: a path scope never covers a
 * command, and a program scope never covers a file. A credential path is never covered at
 * all — the same carve-out a dangerous command gets — because a folder granted for its
 * sources must not quietly start handing its `.env` to the model.
 */
export function grantCoversCall(scope: string, call: GrantCall): boolean {
  const { toolName, inner } = parseScope(scope)
  if (toolName !== call.toolName) return false
  const subject = call.subject ?? 'command'
  const targets = call.targets ?? []
  if (inner === undefined) {
    // A bare tool-name scope, from a call that named nothing. It must not start covering
    // commands, paths or resources later: that would restore exactly the breadth removed.
    return subject === 'resource' && targets.length === 0
  }
  if (subject === 'command') {
    const command = call.command?.trim()
    return !!command && allowPatternCoversCommands(`${inner} *`, [command])
  }
  if (subject === 'path') {
    return (
      targets.length > 0 &&
      targets.every((path) => !isSecretPath(path) && (path === inner || matches(inner, path)))
    )
  }
  return targets.length === 1 && targets[0] === inner
}

/** The rule's Settings spelling: `tool:bash` over `git *` reads `bash(git *)`. */
export function describeGrantRule(rule: { action: string; resource: string }): string {
  return `${rule.action.replace(/^tool:/u, '')}(${rule.resource})`
}
