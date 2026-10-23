import { describe, test } from 'bun:test'
import { expectOwnershipBoundary } from '@localixai/kit/testing/ownership-contract'

// Lives under `scripts/`, not in core: its owner list names files inside bundled mini apps, which
// is integration between the host kit and those mini apps — core itself may not name a mini app
// tree.
const REPO_ROOT = new URL('../', import.meta.url).pathname
const RAW_INPUT = /<input\b/g

/**
 * Native inputs remain explicit only when they implement the primitive itself,
 * are hidden file pickers, or belong to a composite editor that owns its focus,
 * caret, mirror, or sizing mechanics. The exact count prevents ordinary form
 * fields from silently forking Input's geometry and interaction states again.
 */
const NATIVE_INPUT_OWNERS = new Map<string, number>([
  ['apps/ui/src/entities/chat/ui/SessionItem.tsx', 1],
  ['apps/ui/src/entities/chat/ui/prompt-input/PromptInput.tsx', 1],
  // Hidden file picker behind the comment card's Attach button.
  ['apps/ui/src/shared/ui/comments/CommentDraftCard.tsx', 1],
  // Markdown forwards non-task document inputs with their original props and browser styling.
  // App Input chrome would change that document; task checkboxes already use the kit primitive.
  ['apps/ui/src/shared/ui/MarkdownTaskList.tsx', 1],
  ['packages/kit/src/controls/checkbox.tsx', 1],
  // The menu filter drives focus INTO the menu — arrow keys hand off to
  // `[role="menuitem"]`, Enter activates the first match, and IME composition is
  // swallowed so it never reaches the menu's own key handling. SearchInput
  // deliberately omits `ref`, so it cannot own that focus contract.
  ['packages/kit/src/controls/breadcrumb-select-search.tsx', 1],
  ['packages/kit/src/overlays/find-widget.tsx', 1],
  ['packages/kit/src/controls/input.tsx', 1],
  ['packages/kit/src/controls/search-input.tsx', 1],
  // The stepped slider primitive is a native range input under its own track and step dots.
  ['packages/kit/src/controls/slider.tsx', 1],
  ['packages/kit/src/controls/switch.tsx', 1],
  ['mini-apps/api/ui/ui/ImportDialog.tsx', 1], // hidden file picker behind a Button
  ['mini-apps/database/ui/ui/DefaultSqlEditor.tsx', 1],
  ['mini-apps/database/ui/ui/sql-console/ExportMenu.tsx', 1],
  ['mini-apps/learning/ui/LearningLibrary.tsx', 1],
  ['mini-apps/reader/ui/ReaderReadingPane.tsx', 1], // hidden file picker for annotation import
  ['mini-apps/trading/ui/ui/IndicatorParamsInline.tsx', 1],
])

describe('input ownership boundary', () => {
  test('routes ordinary fields through Input and keeps native mechanics explicit', async () => {
    const actual = new Map<string, number>()

    // The kit is where the primitives live; leaving it out would stop counting the owners.
    for (const sourceRoot of ['apps/ui/src', 'packages/kit/src', 'mini-apps']) {
      for (const path of new Bun.Glob('**/*.tsx').scanSync({
        cwd: `${REPO_ROOT}/${sourceRoot}`,
      })) {
        const repoPath = `${sourceRoot}/${path}`
        if (repoPath.endsWith('.test.tsx')) continue
        const source = await Bun.file(`${REPO_ROOT}/${repoPath}`).text()
        const count = [...source.matchAll(RAW_INPUT)].length
        if (count > 0) actual.set(repoPath, count)
      }
    }

    expectOwnershipBoundary(actual, NATIVE_INPUT_OWNERS, 'input')
  })
})
