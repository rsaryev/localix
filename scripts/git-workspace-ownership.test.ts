import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { assertNotVoid, scanSources } from '../apps/api/src/lib/source-lint'

// Lives under `scripts/`, not in core: this is INTEGRATION between the host and one bundled
// plugin, and the same boundary it enforces forbids core from naming a concrete plugin tree.
const REPO_ROOT = path.resolve(import.meta.dir, '..')
const CORE_GLOBS = [
  'apps/api/src/**/*.ts',
  'apps/api/migrations/**/*.ts',
  'apps/ui/src/**/*.ts',
  'apps/ui/src/**/*.tsx',
  // The primitives the host shares moved into the kit; it is core, so the boundary holds there.
  'packages/kit/src/**/*.ts',
  'packages/kit/src/**/*.tsx',
  'packages/plugin-sdk/src/**/*.ts',
]
const REVERSE_IMPORT = /from\s*['"][^'"]*plugins\/git-workspace(?:\/[^'"]*)?['"]/u
const LEGACY_PLUGIN_VOCABULARY =
  /\bworktrees?\b|source-control|git:\/\/|@git:|git-workspace|RESOURCE_SCHEMES\.git/iu

/**
 * External-format literals belong at their translation boundary. Match the exact expression,
 * once, instead of exempting an entire reader: an unrelated plugin route in the same file must
 * still fail. Native discovery no longer reads this format and has no allowance.
 */
const EXTERNAL_FORMAT_LITERALS = new Map([
  [
    'apps/api/src/features/plugins/discovery-cc-files.ts',
    "trimmedFrontmatterField(fields.isolation) === 'worktree' ? ('isolated' as const) : undefined",
  ],
  ['apps/api/src/features/cc-settings/agent-format.test.ts', "'isolation: worktree\\n'"],
])

function hasLegacyVocabulary(file: string, code: string): boolean {
  const externalLiteral = EXTERNAL_FORMAT_LITERALS.get(file)
  const nativeCode = externalLiteral ? code.replace(externalLiteral, '') : code
  return LEGACY_PLUGIN_VOCABULARY.test(file) || LEGACY_PLUGIN_VOCABULARY.test(nativeCode)
}

describe('Git Workspace ownership boundary', () => {
  test('host source has no reverse import into the bundled plugin', async () => {
    const files = await scanSources({
      root: REPO_ROOT,
      include: CORE_GLOBS,
      skip: (file) => file.includes('.test.'),
      minFiles: 300,
    })
    assertNotVoid(
      'host production source',
      files.length,
      'The ownership scan stopped walking core.',
    )
    expect(files.filter((file) => REVERSE_IMPORT.test(file.code)).map((file) => file.file)).toEqual(
      [],
    )
    expect(
      REVERSE_IMPORT.test(`import { x } from '../../../plugins/git-workspace/backend/x'`),
    ).toBe(true)
  })

  test('legacy source-control and worktree feature roots cannot return to core', () => {
    for (const relative of [
      'apps/api/src/features/source-control',
      'apps/api/src/features/worktrees',
      'apps/ui/src/features/source-control',
      'apps/ui/src/shared/api/worktrees-client.ts',
      'apps/ui/src/shared/api/source-control-client.ts',
    ]) {
      expect(existsSync(path.join(REPO_ROOT, relative)), relative).toBe(false)
    }
  })

  test('legacy plugin vocabulary cannot survive in core code, fixtures, or migrations', async () => {
    const files = await scanSources({
      root: REPO_ROOT,
      include: CORE_GLOBS,
      skip: (file) => file.endsWith('git-workspace-ownership.test.ts'),
      minFiles: 300,
    })
    const offenders = files
      .filter((file) => hasLegacyVocabulary(file.file, file.code))
      .map((file) => file.file)
    expect(offenders).toEqual([])

    // An allowance that stops being needed is an allowance that stops being true. Every entry must
    // still be a file that still says the word, or the list quietly grants cover to nothing.
    const stale = [...EXTERNAL_FORMAT_LITERALS.keys()].filter((path) => {
      const file = files.find((candidate) => candidate.file === path)
      return !file || !file.code.includes(EXTERNAL_FORMAT_LITERALS.get(path)!)
    })
    expect(stale).toEqual([])
  })

  test('external literals cannot hide vocabulary elsewhere in the adapter or native core', () => {
    for (const [file, literal] of EXTERNAL_FORMAT_LITERALS) {
      expect(hasLegacyVocabulary(file, literal)).toBe(false)
      expect(hasLegacyVocabulary(file, `${literal}\n${literal}`)).toBe(true)
      expect(hasLegacyVocabulary(file, `${literal}\nconst route = 'git://status'`)).toBe(true)
      expect(hasLegacyVocabulary('apps/api/src/features/agents/native.ts', literal)).toBe(true)
    }
  })

  test('core app and public session contracts do not own plugin routes or state', async () => {
    const files = await scanSources({
      root: REPO_ROOT,
      include: [
        'apps/api/src/app.ts',
        'apps/api/src/client.ts',
        'apps/api/src/features/chat/contracts.ts',
        'apps/ui/src/shared/api/contracts.ts',
      ],
      minFiles: 4,
    })
    const source = files.map((file) => file.code).join('\n')
    expect(source).not.toMatch(/\/rpc\/(?:source-control|worktrees)\b/u)
    expect(source).not.toMatch(/\bWorktree(?:Info|Status|ListItem)\b/u)
    expect(source).not.toContain('session_worktree.updated')
  })

  test('core context and editor contracts stay provider-neutral', async () => {
    const files = await scanSources({
      root: REPO_ROOT,
      include: [
        'apps/api/src/contracts/context-ref-kinds.ts',
        'apps/api/src/features/projects/contracts.ts',
        'apps/api/src/features/projects/expand-refs.ts',
        'apps/ui/src/shared/lib/inspectorBus.ts',
        'apps/ui/src/shared/ui/code-editor/dirtyDiffGutter.ts',
      ],
      minFiles: 5,
    })
    const source = files.map((file) => file.code).join('\n')
    expect(source).not.toMatch(/['"]git['"]|@git:|RESOURCE_SCHEMES\.git/u)
    expect(source).not.toMatch(/\b(?:staged|unstaged|worktree)\b/u)
    expect(source).not.toContain('/rpc/source-control')
  })
})
