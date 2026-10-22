/**
 * What a check found, in the shape `claude plugin validate` reports: an error keeps the part it
 * names from loading, a warning loads it anyway. `path` names the field (`userConfig.TOKEN`) or the
 * file the issue is about.
 */
export interface PluginIssue {
  severity: 'error' | 'warning'
  path: string
  message: string
}

export const issue = (
  severity: PluginIssue['severity'],
  path: string,
  message: string,
): PluginIssue => ({ severity, path, message })

export const hasErrors = (issues: readonly PluginIssue[]): boolean =>
  issues.some((found) => found.severity === 'error')
