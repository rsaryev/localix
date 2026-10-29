import { describe, test } from 'bun:test'
import { expectOwnershipBoundary } from '@localixai/kit/testing/ownership-contract'

const REPO_ROOT = new URL('../', import.meta.url).pathname
const RAW_TEXTAREA = /<textarea\b/g

/**
 * These are editors/composers rather than ordinary form fields: each owns
 * caret/history, mirrored completion, dropzone, or combobox behavior that a
 * visual form primitive must not absorb. The exact count closes the allowlist
 * if another raw textarea is added beside the intentional owner.
 *
 */
const SPECIALIZED_OWNERS = new Map<string, number>([
  ['apps/ui/src/entities/chat/ui/prompt-input/TextArea.tsx', 1],
  ['packages/kit/src/controls/textarea.tsx', 1],
])

describe('textarea ownership boundary', () => {
  test('routes ordinary multiline fields through Textarea and keeps specialized editors explicit', async () => {
    const actual = new Map<string, number>()

    // The kit is where the primitive lives; leaving it out would stop counting its owner.
    for (const sourceRoot of ['apps/ui/src', 'packages/kit/src']) {
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
