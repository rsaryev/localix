/**
 * Build the macro tool-override options from a command/skill's `allowedTools` /
 * `disallowedTools` lists — allowed tools are auto-approved, disallowed ones
 * removed. Returns undefined when neither is set so the macro runs the default
 * toolkit. Shared by the plugin-command and skill-command dispatchers.
 *
 * When `projectDir` is provided, `${CLAUDE_PROJECT_DIR}` inside each token is
 * substituted before the list feeds tool auto-approval (Claude Code v2.1.196:
 * the same substitution applied to skill bodies also applies to `allowed-tools`,
 * so `Bash(${CLAUDE_PROJECT_DIR}/scripts/lint.sh *)` resolves consistently).
 *
 * Dependency-free (pure string work) so it stays unit-testable without pulling in
 * the chat-service graph.
 */
export function toolOverrideOptions(
  src: {
    allowedTools?: string[]
    disallowedTools?: string[]
  },
  projectDir?: string,
): { extraAllowedTools?: string[]; extraDisabledTools?: string[] } | undefined {
  if (!src.allowedTools?.length && !src.disallowedTools?.length) return undefined
  const subst = (list?: string[]) =>
    projectDir && list ? list.map((t) => t.split('${CLAUDE_PROJECT_DIR}').join(projectDir)) : list
  return {
    extraAllowedTools: subst(src.allowedTools),
    extraDisabledTools: subst(src.disallowedTools),
  }
}
