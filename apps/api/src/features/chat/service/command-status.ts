import { PERMISSION_MODE_COPY, type PermissionMode } from '../../../contracts/permission-modes'

export interface StatusFacts {
  title: string
  sessionId: string
  cwd: string
  permissionMode: PermissionMode
  agent?: { name: string; modelId: string; reasoningEffort: string }
  addedDirs: string[]
  plugins: string[]
  /** The Claude Code release Localix follows, which hooks and settings are read as. */
  claudeCodeVersion: string
}

/**
 * `/status`: where Claude Code opens its Status tab, a chat's own facts. Each is read from where
 * the app already keeps it (the session, its settings files, the enabled plugins), never from a
 * copy made for this reply.
 */
export function formatStatus(facts: StatusFacts): string {
  const agent = facts.agent
    ? `\`@${facts.agent.name}\`: ${
        facts.agent.modelId
          ? `\`${facts.agent.modelId}\`, reasoning ${facts.agent.reasoningEffort}`
          : 'no model chosen'
      }`
    : undefined
  const rows = [
    `**Chat:** ${facts.title} (\`${facts.sessionId}\`)`,
    `**Folder:** \`${facts.cwd}\``,
    `**Permission mode:** ${PERMISSION_MODE_COPY[facts.permissionMode].label}`,
    ...(agent ? [`**Agent:** ${agent}`] : []),
    ...(facts.addedDirs.length
      ? [`**Added folders:** ${facts.addedDirs.map((dir) => `\`${dir}\``).join(', ')}`]
      : []),
    ...(facts.plugins.length ? [`**Plugins:** ${facts.plugins.join(', ')}`] : []),
    `**Claude Code compatibility:** ${facts.claudeCodeVersion}`,
  ]
  return ['**Status**', ...rows.map((row) => `- ${row}`)].join('\n')
}
