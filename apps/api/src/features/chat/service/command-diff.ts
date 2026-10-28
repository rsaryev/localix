import type { GitRunner } from '../../../lib/git-in'

export interface DiffPorts {
  /** Run git in the chat's folder; the output, or null when git fails or finds no repository. */
  git: GitRunner
  maxPatchChars?: number
}

/** About what a chat reply shows well; a longer patch is read in the folder's own tools. */
const MAX_PATCH_CHARS = 16_000

/** `text` in a fenced block whose fence is longer than any run of backticks inside it. */
function fenced(language: string, text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${text}\n${fence}`
}

/** The first `max` UTF-16 units of `text`, without half of a character made of two. */
function cut(text: string, max: number): string {
  const high = max > 0 && max < text.length && (text.charCodeAt(max - 1) & 0xfc00) === 0xd800
  return text.slice(0, high ? max - 1 : max)
}

/**
 * `/diff`: the uncommitted changes in the chat's folder, as Claude Code's diff view lists them,
 * from git against the last commit. Files git does not track yet are named but not shown.
 */
export async function runDiff(ports: DiffPorts): Promise<string> {
  if ((await ports.git(['rev-parse', '--is-inside-work-tree'])) !== 'true')
    return 'This folder is not a git repository, so there is nothing to compare.'
  const status = await ports.git(['status', '--short'])
  if (!status) return 'No uncommitted changes in this folder.'
  // A repository with no commit yet has no HEAD to compare with.
  const patch = (await ports.git(['diff', 'HEAD'])) ?? (await ports.git(['diff'])) ?? ''
  const max = ports.maxPatchChars ?? MAX_PATCH_CHARS
  const shown = cut(patch, max)
  const rest = patch.length - shown.length
  const parts = [
    '**Uncommitted changes**',
    fenced('text', status),
    ...(shown ? [fenced('diff', shown)] : []),
    ...(rest > 0
      ? [
          `${rest} more characters of the patch are not shown; run \`git diff\` in the folder to read them.`,
        ]
      : []),
    ...(/^\?\?/m.test(status) ? ['Untracked files are listed, not shown.'] : []),
  ]
  return parts.join('\n\n')
}
