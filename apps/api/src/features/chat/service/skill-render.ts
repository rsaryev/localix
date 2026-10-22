import { dirname } from 'node:path'
import { expandFileReferences } from './file-references'
import { expandSkillContent, type AuthorizeSkillCommand } from './skill-commands'
import { applySkillArguments } from './slash-commands'

/** The parts of a skill its rendering reads. */
export interface RenderableSkill {
  content: string
  /** Absolute path of its `SKILL.md`; its folder is `${CLAUDE_SKILL_DIR}`. */
  path?: string
  argumentNames?: string[]
}

export interface SkillRenderContext {
  sessionId: string
  /** The session working dir: where injected commands run, and `${CLAUDE_PROJECT_DIR}`. */
  workingDir: string
  effort: string
  /** Extra environment for injected commands (a plugin skill's `CLAUDE_PLUGIN_*`). */
  env?: Record<string, string>
  /**
   * Run `` !`cmd` `` and inline `@path` references. Only for a `SKILL.md` on disk (the person's
   * own, or an enabled plugin's); a skill stored elsewhere is substituted, never executed.
   */
  dynamic: boolean
  /**
   * Asked about each injected command before any runs (`SkillCommandPermissionError` on a
   * refusal). The model's `skill` tool sets it; a person typing `/name` invoked it themselves.
   */
  authorize?: AuthorizeSkillCommand
}

/**
 * A skill's content as Claude Code renders it before the model reads it, whoever invokes it — a
 * person typing `/name` or the model calling the skill tool: injected commands run (seeing the
 * arguments), `@path` references inline, then the arguments and `${CLAUDE_*}` variables are
 * substituted. A failing command throws `SkillCommandFailedError`; the caller reports it.
 */
export async function renderSkillBody(
  skill: RenderableSkill,
  args: string,
  ctx: SkillRenderContext,
): Promise<string> {
  const skillDir = skill.path ? dirname(skill.path) : undefined
  const env: Record<string, string> = {
    CLAUDE_SESSION_ID: ctx.sessionId,
    // env-vars.md: CLAUDE_CODE_SESSION_ID is the session id in every Bash subprocess.
    CLAUDE_CODE_SESSION_ID: ctx.sessionId,
    CLAUDE_EFFORT: ctx.effort,
    CLAUDE_PROJECT_DIR: ctx.workingDir,
    ...(skillDir ? { CLAUDE_SKILL_DIR: skillDir } : {}),
    ...ctx.env,
  }
  // @path references are scanned after the commands ran; bases: the working dir and the skill's
  // own folder (a bundled `@reference.md`), both confinement-gated.
  const expanded = ctx.dynamic
    ? await expandFileReferences(
        await expandSkillContent(
          skill.content,
          ctx.workingDir,
          env,
          { raw: args, ...(skill.argumentNames ? { names: skill.argumentNames } : {}) },
          ctx.authorize,
        ),
        [ctx.workingDir, ...(skillDir ? [skillDir] : [])],
      )
    : skill.content
  return applySkillArguments(expanded, args, {
    argumentNames: skill.argumentNames,
    skillDir,
    sessionId: ctx.sessionId,
    effort: ctx.effort,
    projectDir: ctx.workingDir,
    sourceTemplate: skill.content,
  })
}
