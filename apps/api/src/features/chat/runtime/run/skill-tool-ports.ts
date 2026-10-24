import { sessionRoute } from '../../../../contracts/session-route'
import { userHome } from '../../../../lib/env'
import type { DiscoveredSkill } from '../../../agent-core/skill-discovery'
import { announceSkillInvoked } from '../../../agent-core/skill-invocations'
import { verdictOf, type VerdictOptions } from '../../../agent-core/permission-verdict'
import { TOOL } from '../../../agent-core/tool-names'
import { pluginDataDir } from '../../../plugins/mcp'
import type { SessionRecord } from '../../repository'
import type { RunnerDeps } from '../agent-runner-types'
import type { CcHookSessions } from '../cc-hook-sessions'
import { skillPermissionRules } from './permission-gate-build'
import { skillToolPathVars, substituteToolPathVars } from '../../../agent-core/skill-tool-path-vars'

/** The run's permission inputs, filled once its gate is built (`stages/intake.ts`). */
export type SkillCommandPolicyRef = { current?: VerdictOptions }

/**
 * Claude Code checks each command a skill injects against the permission rules before any runs:
 * "Injected commands never prompt for permission while the skill renders", so outside auto mode
 * anything but `allow` aborts the load with `Shell command permission check failed`. The skill's
 * own `allowed-tools` pre-approve, as they do for its run; a denial still wins over them. A run
 * whose gate is not built yet, or whose agent has no shell, runs nothing: the model must not get a
 * shell through a skill that it does not hold, or that a read-only mode withholds.
 */
export function authorizeSkillCommands(
  policy: SkillCommandPolicyRef | undefined,
  skill: Pick<DiscoveredSkill, 'allowedTools'> &
    Partial<Pick<DiscoveredSkill, 'path' | 'pluginRoot' | 'pluginName'>>,
  projectDir?: string,
): (command: string) => string | undefined {
  // The skill's `${CLAUDE_*}` paths filled into its own rules, as its body gets them.
  const allowedTools = substituteToolPathVars(
    skill.allowedTools,
    skillToolPathVars({
      projectDir,
      path: skill.path,
      pluginRoot: skill.pluginRoot,
      pluginDataDir: skill.pluginName ? pluginDataDir(skill.pluginName, userHome()) : undefined,
    }),
  )
  return (command) => {
    const options = policy?.current
    if (!options) return 'the permission rules of this run are not available'
    if (!options.toolsByName.has(TOOL.bash)) return 'this agent has no shell tool'
    const verdict = verdictOf({
      ...options,
      preapprovedRules: [
        ...(options.preapprovedRules ?? []),
        ...skillPermissionRules(allowedTools, options.root),
      ],
    })(TOOL.bash, { command })
    if (verdict.decision === 'allow') return undefined
    const why = verdict.reason ?? (verdict.rule ? `rule ${verdict.rule}` : '')
    return verdict.decision === 'deny'
      ? `denied${why ? ` (${why})` : ''}`
      : `not pre-approved, it would need approval${why ? ` (${why})` : ''}; allow it in the permission rules or the skill's allowed-tools`
  }
}

/** Each `type: command` handler of a raw frontmatter `hooks` map, as the shell would run it. */
function commandHookTexts(raw: unknown): string[] {
  const texts: string[] = []
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isRecord(raw)) return texts
  for (const groups of Object.values(raw)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue
      for (const handler of group.hooks) {
        if (!isRecord(handler)) continue
        if ((typeof handler.type === 'string' ? handler.type : 'command') !== 'command') continue
        const args = Array.isArray(handler.args) ? handler.args.map(String) : []
        texts.push([String(handler.command ?? ''), ...args].join(' ').trim())
      }
    }
  }
  return texts
}

/** The plugin a skill came from, as its commands and hooks see it. */
function skillPlugin(skill: DiscoveredSkill) {
  if (!skill.pluginName || !skill.pluginRoot) return undefined
  return {
    name: skill.pluginName,
    root: skill.pluginRoot,
    dataDir: skill.pluginDataDir ?? pluginDataDir(skill.pluginName, userHome()),
  }
}

/**
 * The host half of the `skill` tool's `get` (`agent-core/tools/skill.ts`): a skill the model loads
 * runs as one the person types as `/name` does. Its content renders the same way (commands,
 * arguments, `${CLAUDE_*}`), a plugin monitor waiting for it starts, and its frontmatter `hooks`
 * register for the rest of the session (Claude Code: "registers them when you or Claude invoke the
 * skill"), from the session's next run on, once their commands pass the run's rules.
 */
export function skillToolPorts(input: {
  userId: string
  session: SessionRecord
  defaultCwd: string
  renderSkill?: RunnerDeps['renderSkill']
  ccHookSessions?: CcHookSessions
  /** The run's permission inputs: each command a loaded skill injects is checked against them. */
  commandPolicy?: SkillCommandPolicyRef
}): {
  onSkillLoaded: (skill: DiscoveredSkill) => void
  renderSkill?: (skill: DiscoveredSkill, args: string) => Promise<string>
} {
  const { userId, session, defaultCwd, renderSkill, ccHookSessions, commandPolicy } = input
  return {
    onSkillLoaded: (skill) => {
      announceSkillInvoked({
        userId,
        sessionId: session.rootSessionId ?? session.id,
        skillName: skill.name,
        ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
        ...(defaultCwd ? { cwd: defaultCwd } : {}),
      })
      if (!skill.hooks) return
      const plugin = skillPlugin(skill)
      // A command hook runs as `sh -c` on later turns, outside the gate. Enabling a plugin is
      // the consent for its hooks; any other skill the model loads (a checkout's, or one it
      // wrote) registers none unless the run's rules would let the shell run each command.
      if (!plugin) {
        const authorize = authorizeSkillCommands(commandPolicy, skill, defaultCwd)
        if (commandHookTexts(skill.hooks).some((command) => authorize(command) !== undefined)) {
          return
        }
      }
      ccHookSessions?.addSkillHooks(session.id, {
        raw: skill.hooks,
        source: 'skill',
        lifetime: 'session',
        ...(plugin ? { plugin } : {}),
      })
    },
    ...(renderSkill
      ? {
          renderSkill: (skill: DiscoveredSkill, args: string) => {
            const plugin = skillPlugin(skill)
            return renderSkill(skill, args, {
              sessionId: session.id,
              workingDir: defaultCwd,
              effort: sessionRoute(session).reasoningEffort ?? 'low',
              ...(plugin
                ? { env: { CLAUDE_PLUGIN_ROOT: plugin.root, CLAUDE_PLUGIN_DATA: plugin.dataDir } }
                : {}),
              // Every skill the tool loads is a SKILL.md on disk: the person's or an enabled
              // plugin's, the same files a typed `/name` runs the commands of.
              dynamic: true,
              // The model asked for this, not the person: every command meets the rules first.
              authorize: authorizeSkillCommands(commandPolicy, skill, defaultCwd),
            })
          },
        }
      : {}),
  }
}
