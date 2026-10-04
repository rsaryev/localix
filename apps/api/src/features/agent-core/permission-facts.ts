import type { AgentTool } from '@localixai/agent/agents'

import { asStringArray } from '../../lib/coerce'
import { homedir } from 'node:os'

import { defaultSkillFilePath } from './skill-discovery'
import { resolveFileTarget } from './tools/file/file-utils'
import { resolveToolCwd } from './tools/environment'
import { outsideHomePathsInCommand } from './tools/workspace'
import { isOutsideWorkspace } from './workspace-containment'
import { isCatastrophic, isDangerous, isReadOnlyCommand } from './tools/bash/bash'
import { isSecretPath } from './secret-paths'
import { patchTargetPaths } from './tools/patch/patch'
import { terminalActionCommandCandidates } from './tools/terminal/terminal'

/**
 * Per-tool call-fact extraction — the only tool-specific layer of the permission
 * system. It maps a tool name + raw input into the path/command/danger facts the
 * rule engine matches against. Kept separate from the rule-matching engine and
 * the gate orchestration (`permission-engine.ts`), which stay tool-agnostic.
 */

/** What a rule's `pattern` is matched against — derived from the actual tool input. */
export interface CallFacts {
  /** Tool-declared native resources, independent of filesystem and shell syntax. */
  resources?: readonly string[]
  /** Resolved target paths (files / cwd) the call touches. */
  paths: string[]
  /** Subset of `paths` that fall outside the workspace root. */
  outsidePaths: string[]
  outsideWorkspace: boolean
  /**
   * The call names paths and every one of them is inside the workspace.
   *
   * NOT `!outsideWorkspace`. A call with no paths at all — most shell lines — is not outside
   * the workspace, but it is not inside it either, and a rule saying "allow inside" must not
   * quietly cover every command that mentions no file.
   */
  insideWorkspace: boolean
  /** True for a destructive shell command. */
  dangerous: boolean
  /** The subset of `dangerous` that cannot be undone — see `isCatastrophic`. */
  catastrophic: boolean
  /** Every command in the call only reads. False when there is no command to judge. */
  readOnly: boolean
  /** A resolved path looks like a credential — see `secret-paths.ts`. */
  touchesSecret: boolean
  /** Individual executable inputs, so command-pattern rules can inspect every batch entry. */
  commands?: string[]
  /** The display command is a privacy-safe label; do not send it to a prose classifier. */
  commandRedacted?: boolean
  command?: string
  sourceTitle?: string
}

/**
 * Filesystem readers whose output can enter model context. Unlike mutations, a read is
 * auto-approved only when its resolved path is contained by the session workspace itself —
 * or by the session scratch tree, which holds nothing but what agents wrote. The wider
 * agent-owned root (`~/.localix`: the database, the vault, provider state) is a mutation
 * carve-out, not a source of silently attachable context.
 *
 * The scratch exception is measured, not assumed: a delegated task run wrote a test script into its
 * own scratch dir (allowed), then read it back and was stopped by a confirmation routed to a
 * human who was not there — for a file the agent had produced one call earlier.
 */
function classifyCall(
  paths: readonly string[],
  outsidePaths: readonly string[],
  commands: readonly string[],
): {
  outsideWorkspace: boolean
  insideWorkspace: boolean
  dangerous: boolean
  catastrophic: boolean
  readOnly: boolean
  touchesSecret: boolean
} {
  return {
    outsideWorkspace: outsidePaths.length > 0,
    insideWorkspace: paths.length > 0 && outsidePaths.length === 0,
    dangerous: commands.some((command) => isDangerous(command)),
    catastrophic: commands.some((command) => isCatastrophic(command)),
    readOnly: commands.length > 0 && commands.every((command) => isReadOnlyCommand(command)),
    touchesSecret: paths.some((path) => isSecretPath(path)),
  }
}

export function extractCallFacts(
  toolName: string,
  input: unknown,
  root?: string,
  /** Tool-owned declarations augment the core path and command facts. */
  tool?: Pick<AgentTool, 'permissionPaths' | 'permissionResources'>,
): CallFacts {
  const declaredResources = tool?.permissionResources?.(input)
  if (
    tool?.permissionResources &&
    (!Array.isArray(declaredResources) ||
      [...declaredResources].some((resource) => typeof resource !== 'string' || !resource))
  ) {
    throw new Error(`Invalid permission resources declared by ${toolName}`)
  }
  const resourceFacts = declaredResources ? { resources: [...new Set(declaredResources)] } : {}
  const i = (input ?? {}) as Record<string, unknown>
  const cwd = typeof i.cwd === 'string' ? i.cwd : undefined
  const paths: string[] = []
  let command: string | undefined

  switch (toolName) {
    // `edit` names its file exactly like `write` (`path`, optional `cwd`). Without it here the
    // call produced NO paths, so the host-root guard, the outside-workspace and secrets classes
    // and every path-pattern rule saw nothing — an edit could rewrite a file `write` is asked for.
    case 'read':
    case 'write':
    case 'edit': {
      if (typeof i.path === 'string') paths.push(resolveFileTarget(i.path, cwd, root).path)
      break
    }
    case 'skill': {
      // `save`/`delete` write a real file; discovery actions touch nothing. With no case
      // here at all this fell through to `paths: []`, so path-pattern rules could not
      // inspect skill writes. Global skills now live under the agent-owned
      // `~/.localix/skills` root, which is intentionally allowed without the generic
      // outside-workspace prompt, but the concrete path still belongs in the facts.
      if (i.action !== 'save' && i.action !== 'delete') break
      if (typeof i.name !== 'string' || !i.name) break
      // `save` honours `scope`, so its base is predictable: homedir() for a global skill,
      // otherwise the project. `delete` does NOT honour it — it resolves the target through
      // discovery (deleteSkillByName -> discoverFilesystemSkills), where a PERSONAL/home
      // skill WINS a name clash and the walk reaches above the workspace. So a delete can
      // recursively remove a directory under homedir() while `scope` says "project".
      //
      // This runs pre-execution and cannot await discovery, so a delete declares BOTH
      // candidates so path-pattern rules can judge either concrete target.
      // `cwd`/`root` may be absent; a relative path resolves against `cwd` anyway, so '.'
      // is the honest project base when neither is known.
      const project = root ?? cwd ?? '.'
      const bases =
        i.action === 'delete' ? [homedir(), project] : [i.scope === 'global' ? homedir() : project]
      for (const base of bases) {
        // Path from the ONE builder the writer uses, never re-derived here.
        paths.push(resolveFileTarget(defaultSkillFilePath(base, i.name), cwd, root).path)
      }
      break
    }
    // `view_image` resolves its `path` with `resolveFileTarget` and honours it absolutely, so
    // a user path rule must be able to see it. Neither writes the named file itself
    // It only reads the file, so no cwd is added —
    // the file alone is the boundary that matters.
    case 'view_image': {
      const named = i.path
      if (typeof named === 'string') paths.push(resolveFileTarget(named, cwd, root).path)
      break
    }
    case 'apply_patch': {
      if (typeof i.patch === 'string') {
        for (const p of patchTargetPaths(i.patch)) paths.push(resolveFileTarget(p, cwd, root).path)
      }
      paths.push(resolveFileTarget('.', cwd, root).cwd)
      break
    }
    case 'bash': {
      // Mirror bash.execute's dispatch order exactly: interactive action first; otherwise a
      // non-empty `commands[]` batch wins over the single `command`. Treating ignored fields as
      // executable makes the gate disagree with the tool (and can surface irrelevant secrets).
      const single = typeof i.command === 'string' ? i.command : ''
      const batch = asStringArray(i.commands)
      const terminalCandidates = terminalActionCommandCandidates(i)
      const allCommands =
        terminalCandidates ?? (batch.length > 0 ? batch : single.length > 0 ? [single] : [])
      // Literal PTY input can contain credentials and the terminal tool deliberately never echoes
      // it. It is still inspected internally for danger/path rules, but the confirm card gets a
      // privacy-safe label. An `open` command and ordinary shell commands remain inspectable.
      const terminalInput = i.action === 'type' || i.action === 'keys'
      command = terminalInput
        ? `interactive terminal ${String(i.action)}`
        : allCommands.join('\n') || undefined
      // The SAME resolver the bash tool itself uses — a second copy here would let the
      // gate judge a relative `cwd` against a different directory than the one the
      // command actually runs in.
      const resolvedCwd = resolveToolCwd(cwd, root)
      paths.push(resolvedCwd)
      for (const c of allCommands) paths.push(...outsideHomePathsInCommand(c, root, resolvedCwd))
      const commands = allCommands.length > 0 ? allCommands : undefined
      const outsidePaths = [...new Set(paths.filter((p) => isOutsideWorkspace(toolName, root, p)))]
      return {
        ...resourceFacts,
        paths,
        outsidePaths,
        ...classifyCall(paths, outsidePaths, allCommands),
        commands,
        commandRedacted: terminalInput || undefined,
        command,
      }
    }
    case 'search': {
      if (cwd) paths.push(resolveFileTarget('.', cwd, root).cwd)
      break
    }
    default: {
      // A tool this switch has never heard of — every plugin tool, by construction. Core cannot add
      // a case per plugin, and a tool with no paths is invisible to the `outside-workspace` rule and
      // to every user path rule, so the TOOL declares its own targets (`AgentTool.permissionPaths`).
      // Reached only in `default`, so a core case can never be overridden or bypassed by one.
      //
      // Plugin code runs here, on the permission path, before anything is allowed: a throw or a
      // non-array must degrade to "declared nothing" rather than become an exception in the gate,
      // which would fail the run instead of asking.
      let declared: unknown
      try {
        declared = tool?.permissionPaths?.(input)
      } catch {
        declared = undefined
      }
      if (Array.isArray(declared)) {
        for (const target of declared) {
          if (typeof target === 'string' && target) {
            paths.push(resolveFileTarget(target, cwd, root).path)
          }
        }
      }
      break
    }
  }

  const outsidePaths = [...new Set(paths.filter((p) => isOutsideWorkspace(toolName, root, p)))]
  return {
    ...resourceFacts,
    paths,
    outsidePaths,
    ...classifyCall(paths, outsidePaths, command ? [command] : []),
    command,
  }
}

/**
 * The facts for a call that is only a declared RESOURCE — no paths, no command.
 *
 * Exported so a caller checking a requirement ahead of the run (`required-tools.ts`) asks the
 * same shape a live call produces. Hand-built literals drifted the moment a class was added:
 * a missing field is a class that silently answers "no" for everyone who forgot it.
 */
export function resourceOnlyCall(resources: readonly string[]): CallFacts {
  return {
    resources: [...resources],
    paths: [],
    outsidePaths: [],
    ...classifyCall([], [], []),
  }
}

/** Resolved file targets a write/edit/apply_patch call would mutate (excludes cwd). */
export function writeTargets(toolName: string, input: unknown, root?: string): string[] {
  const i = (input ?? {}) as Record<string, unknown>
  const cwd = typeof i.cwd === 'string' ? i.cwd : undefined
  if (toolName === 'write' || toolName === 'edit') {
    return typeof i.path === 'string' ? [resolveFileTarget(i.path, cwd, root).path] : []
  }
  if (toolName === 'apply_patch') {
    return typeof i.patch === 'string'
      ? patchTargetPaths(i.patch).map((p) => resolveFileTarget(p, cwd, root).path)
      : []
  }
  return []
}
