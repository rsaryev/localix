import { toast } from '@localixai/mini-app-sdk/ui'
import { miniAppErrorDetail } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

/**
 * How this mini app reports a failed git operation.
 *
 * Git answers in stderr, and stderr is never one sentence: a rejected push is four lines of
 * `error:`/`hint:`, a blocked checkout names every file it would overwrite. Every op here used to
 * report with `toast.error(errorMessage(err, 'Push failed'))`, which drops the fallback the moment
 * the error carries any message at all — so the person read git's wall of text and was never told
 * which button produced it.
 *
 * The rule: the sentence is ours, the raw text is git's and goes to the detail body, unchanged, so
 * an operator loses nothing.
 *
 * Deliberately NOT a single `failureSentence(err, action)`: the caller always knows WHICH operation
 * the person just asked for, and no server sentence can say that. Here each says its own half —
 * ours names the action, git's names the cause.
 */
export function gitFailed(action: string, error: unknown): void {
  toast.error(action, { description: gitDetail(error) })
}

/**
 * Run ONE git op and report its failure in the house shape; resolves whether it succeeded.
 *
 * One op per call: an op that bundles two (stage-then-commit) would report the first one's failure
 * under the second one's name.
 */
export async function guardGit(action: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    gitFailed(action, err)
    return false
  }
}

/**
 * Git's own words, or nothing when the thrown value carried none worth showing.
 *
 * `detail` first: the routes classify (`defineTypedError` over git's stderr) and put their sentence
 * in the message slot with the FULL stdout+stderr in `detail`. Reading `.message` alone would show
 * the classification twice — once as our line, once as its body — and throw away everything past
 * the first line, which for a rejected push or a blocked checkout is the part naming the refs and
 * the files.
 */
export function gitDetail(error: unknown): string | undefined {
  return miniAppErrorDetail(error) ?? (errorMessage(error, '') || undefined)
}

/**
 * What we say when reading a repository fails, given what git said.
 *
 * The panel used to print the raw text across the top of itself: `fatal: detected dubious ownership
 * in repository at '/Users/…'` states a fact and hides the one command that fixes it. These four
 * cases cover everything the read path actually throws; anything else keeps a plain sentence and
 * the exact text one click away.
 */
export function gitReadProblem(
  raw: string,
  fallback = 'Could not read this repository’s git state',
): { message: string; hint?: string } {
  const text = raw.toLowerCase()
  if (text.includes('dubious ownership')) {
    return {
      message: 'Git refuses to read this repository because it belongs to another user',
      hint: 'Trust it with: git config --global --add safe.directory <path>',
    }
  }
  if (text.includes('index.lock')) {
    return {
      message: 'Another git process is holding this repository',
      hint: 'Wait for it to finish, or remove .git/index.lock if no git command is running.',
    }
  }
  if (text.includes('enoent') || text.includes('command not found')) {
    return {
      message: 'Git is not installed, or not on this app’s PATH',
      hint: 'Install git, then reopen the session.',
    }
  }
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return {
      message: 'Lost the connection to the Localix server',
      hint: 'The panel keeps showing the last state it read. It refreshes when the server is back.',
    }
  }
  return { message: fallback }
}
