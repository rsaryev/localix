import os from 'node:os'

import { localixHome } from '../../lib/env'
import { canonicalCandidate, hostRootContaining, hostRoots } from '../../lib/host-roots'
import { isPathWithin } from '../../lib/path-containment'
import type { CallFacts } from './permission-facts'
import { resolveToolCwd } from './tools/environment'
import { commandPathTokens } from './tools/workspace'

/**
 * THE HOST-ROOT GUARD — no agent call may read or edit the Localix application itself.
 *
 * The defect it stops: every other boundary here is a RULE, and rules are the user's to edit.
 * The baseline preset can be deleted from Settings, a `bypass` session rewrites every `ask` into
 * an `allow`, and a project rule can allow `outside-workspace`. None of those should ever let an
 * agent open the checkout or the install directory that runs it — rewriting the host from
 * inside is not a permission question, it is a boundary of the product. So this runs in the
 * gate BEFORE the rule engine, and it is not expressible as a rule any mode can rewrite.
 *
 * What it reads: the same resolved facts the rules match (file targets, bash cwd, a plugin
 * tool's declared paths), plus every path-shaped token of each shell command — unfiltered,
 * because the outside-workspace extractor keeps only paths under the home dir and a packaged
 * install lives under `/Applications` or `C:\Program Files`.
 *
 * Two exemptions. The mini app kit directory is readable (read and search only). A host root
 * that CONTAINS the session's own project directory is the other: a developer who deliberately
 * opened the Localix checkout as their project keeps working on it; a session anywhere else
 * does not reach it. `~/.localix` is never a violation (and `host-roots.ts`
 * already refuses any root that would swallow it).
 */

export const HOST_ROOT_DENIAL =
  'belongs to the Localix application itself (its installation or source tree), which agents ' +
  'must not read or modify. Agents work in ~/.localix and in the session project folder — ' +
  'do not retry this path or reach it another way.'

/** Every path a call names, for the host-root question. */
function candidatePaths(input: unknown, call: CallFacts, root: string | undefined): string[] {
  const i = (input ?? {}) as Record<string, unknown>
  const cwd = resolveToolCwd(typeof i.cwd === 'string' ? i.cwd : undefined, root)
  const commands = call.commands ?? (call.command && !call.commandRedacted ? [call.command] : [])
  const fromCommands = commands.flatMap((command) => {
    const tokens = commandPathTokens(command, cwd, os.homedir())
    return [...tokens.absolute, ...tokens.relative]
  })
  return [...call.paths, ...fromCommands]
}

/**
 * The denial for a call that reaches a host root, or `undefined` when it does not.
 * `roots` is injectable for tests; production reads the process-wide {@link hostRoots}.
 */
export function hostRootDenial(
  input: unknown,
  call: CallFacts,
  root: string | undefined,
  roots: readonly string[] = hostRoots(),
): string | undefined {
  const project = root ? [root, canonicalCandidate(root)] : []
  const guarded = roots.filter((r) => !project.some((p) => isPathWithin(r, p)))
  if (guarded.length === 0) return undefined
  const state = localixHome()
  for (const candidate of candidatePaths(input, call, root)) {
    if (isPathWithin(state, candidate) || isPathWithin(state, canonicalCandidate(candidate))) {
      continue
    }
    if (hostRootContaining(candidate, guarded)) return `Blocked: ${candidate} ${HOST_ROOT_DENIAL}`
  }
  return undefined
}
