import type { AgentToolResult, AgentToolUpdateCallback } from '@localixai/agent/agents'
import { DEFAULT_MAX_LINES } from '@localixai/agent'
import { modelFacingMatches, truncateOutput } from './search-output'
import type { SearchToolDetails } from './search-contracts'
import { plural } from '../../../../lib/plural'

/** Keep one sentinel beyond the model-facing line cap so truncation is observable. */
export const FILE_LIST_LIMIT = DEFAULT_MAX_LINES

/** Present ripgrep file-list output without changing process execution or retry policy. */
export function presentFileListing({
  res,
  input,
  cwd,
  onUpdate,
}: {
  res: { stdout: string; stderr: string; exitCode: number }
  input: { glob?: string }
  cwd: string
  onUpdate?: AgentToolUpdateCallback<SearchToolDetails>
}): AgentToolResult<SearchToolDetails> {
  const listed = res.stdout.trim()
  if (listed) {
    const paths = listed.split('\n')
    const sourceTruncated = paths.length > FILE_LIST_LIMIT
    const files = (sourceTruncated ? paths.slice(0, FILE_LIST_LIMIT) : paths).join('\n')
    const bounded = truncateOutput(files)
    const details: SearchToolDetails = {
      query: '',
      cwd,
      glob: input.glob,
      ...bounded,
      truncated: sourceTruncated || bounded.truncated,
    }
    onUpdate?.(details)
    const count = sourceTruncated ? FILE_LIST_LIMIT : paths.length
    const countLabel = sourceTruncated
      ? `More than ${FILE_LIST_LIMIT} files (showing first ${FILE_LIST_LIMIT})`
      : plural(count, 'file')
    return {
      content: `${countLabel} matching glob "${input.glob}":\n${modelFacingMatches(bounded.output, 'file')}`,
      details,
    }
  }
  if (res.exitCode === 127 || /not found|no such file|ENOENT/i.test(res.stderr)) {
    return {
      content: 'ripgrep (rg) is not available here — use `Bash` with find for this.',
      isError: true,
    }
  }
  if (res.exitCode > 1 || res.stderr.trim()) {
    const reason = res.stderr.trim() || `ripgrep failed (exit code ${res.exitCode})`
    return { content: `glob error: ${reason.slice(0, 200)}`, isError: true }
  }
  return { content: `No files matching glob "${input.glob}" in ${cwd}.` }
}
