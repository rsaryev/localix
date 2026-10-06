/** Declaration format for observing delegated CLI sessions, including wrappers and shims. */
export const LAUNCH_AGENT_VAR = 'LOCALIX_AGENT'
export const LAUNCH_CWD_VAR = 'LOCALIX_AGENT_CWD'

/** Emit the same declaration that the live observer reads from delegated terminal commands. */
export function agentLaunchCommand(input: {
  readonly provider: string
  readonly executable: string
  readonly cwd?: string
}): string {
  const cwd = input.cwd?.trim()
  const cwdPart = cwd ? `${LAUNCH_CWD_VAR}='${cwd}' ` : ''
  return `${LAUNCH_AGENT_VAR}=${input.provider} ${cwdPart}${input.executable}`
}
