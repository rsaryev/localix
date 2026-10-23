import { describe, test } from 'bun:test'
import { expectOwnershipBoundary } from '@localixai/kit/testing/ownership-contract'

const REPO_ROOT = new URL('../', import.meta.url).pathname
const RAW_TEXTAREA = /<textarea\b/g

/**
 * Lives under `scripts/`, not in core: this contract holds across the WHOLE repository — core and
 * every bundled mini app — and core may not name a concrete mini app tree. It was in `apps/ui` and
 * listed a mini app's commit box by path, which is the boundary violation it exists to prevent.
 *
 * These are editors/composers rather than ordinary form fields: each owns
 * caret/history, mirrored completion, dropzone, or combobox behavior that a
 * visual form primitive must not absorb. The exact count closes the allowlist
 * if another raw textarea is added beside the intentional owner.
 *
 */
const SPECIALIZED_OWNERS = new Map<string, number>([
  ['apps/ui/src/entities/chat/ui/prompt-input/TextArea.tsx', 1],
  // The mini app's commit box, for the same reason as core's above: an inline-completion ghost
  // is absolutely positioned over the field, so the two must share exact metrics that
  // `Textarea`'s own sizing would override.
  ['mini-apps/git-workspace/ui/source-control/ui/CommitBox.tsx', 1],
  // The board's code element: a transparent textarea over a highlighted `<pre>` of the very same
  // metrics, so the caret stays true under the board's CSS zoom — the same shared-metrics reason.
  ['mini-apps/project-space/ui/elements/CodeArea.tsx', 1],
  ['packages/kit/src/controls/textarea.tsx', 1],
])

describe('textarea ownership boundary', () => {
  test('routes ordinary multiline fields through Textarea and keeps specialized editors explicit', async () => {
    const actual = new Map<string, number>()

    // The kit is where the primitive lives; leaving it out would stop counting its owner.
    for (const sourceRoot of ['apps/ui/src', 'packages/kit/src', 'mini-apps']) {
      for (const path of new Bun.Glob('**/*.tsx').scanSync({
        cwd: `${REPO_ROOT}/${sourceRoot}`,
      })) {
        const repoPath = `${sourceRoot}/${path}`
        if (repoPath.endsWith('.test.tsx')) continue
        const source = await Bun.file(`${REPO_ROOT}/${repoPath}`).text()
        const count = [...source.matchAll(RAW_TEXTAREA)].length
        if (count > 0) actual.set(repoPath, count)
      }
    }

    expectOwnershipBoundary(actual, SPECIALIZED_OWNERS, 'textarea')
  })
})
