import { describe, expect, test } from 'bun:test'

import { extractCallFacts } from '../../permission-facts'
import { parsePatchText } from './patch-parse'
import { patchTargetPaths } from './patch-scope'

/**
 * The permission gate must see every path the APPLIER will write.
 *
 * `patchTargetPaths` is a cheap header scan that exists so the gate does not pay for a
 * full parse — but it was a SECOND, narrower reader of the same input: its regex matched
 * only `Add File|Delete File|Move to|Update File`, while the parser also accepts
 * `*** File: ` (FILE_HEADER_ALT) and converts a raw git/unified diff in place. Anything
 * the scanner missed resolved to no write targets, so `outsideWorkspace` came out false.
 * Measured against the real engine: with DEFAULT_PERMISSION_RULES the canonical header
 * answers `ask` while `*** File:` and a pasted git diff answered `allow` — the prompt was
 * dodgeable purely by choosing a supported header form, and Claude-Code `permissions`
 * deny globs were defeated identically, since they match the same target list. (How the
 * per-MODE rule sets compose on top of the defaults is a separate layer and is not
 * asserted here; these tests pin the FACTS the rules read.)
 *
 * This suite pins the two readers together per dialect. A new header form added to the
 * parser without teaching the scanner fails here rather than silently opening the gate.
 */
const OUTSIDE = '../../../.ssh/authorized_keys'

const DIALECTS: Array<{ label: string; patch: string; expect: string[] }> = [
  {
    label: 'canonical Add File',
    patch: `*** Begin Patch\n*** Add File: ${OUTSIDE}\n+ssh-rsa AAAA\n*** End Patch`,
    expect: [OUTSIDE],
  },
  {
    label: 'canonical Update File',
    patch: `*** Begin Patch\n*** Update File: ${OUTSIDE}\n@@\n-old\n+new\n*** End Patch`,
    expect: [OUTSIDE],
  },
  {
    label: 'canonical Delete File',
    patch: `*** Begin Patch\n*** Delete File: ${OUTSIDE}\n*** End Patch`,
    expect: [OUTSIDE],
  },
  {
    // The alt header the parser accepts (FILE_HEADER_ALT) — the scanner did not.
    label: '*** File: alt header',
    patch: `*** Begin Patch\n*** File: /Users/nobody/.zshrc\n@@\n-old\n+evil\n*** End Patch`,
    expect: ['/Users/nobody/.zshrc'],
  },
  {
    // A raw git diff pasted inside the envelope: the parser synthesizes `*** … File:`
    // directives from it, so the applier writes these paths.
    label: 'raw git diff, new file',
    patch:
      `*** Begin Patch\ndiff --git a/${OUTSIDE} b/${OUTSIDE}\nnew file mode 100644\n` +
      `--- /dev/null\n+++ b/${OUTSIDE}\n@@ -0,0 +1 @@\n+ssh-rsa AAAA\n*** End Patch`,
    expect: [OUTSIDE],
  },
  {
    label: 'raw git diff, modified file',
    patch:
      `*** Begin Patch\ndiff --git a/${OUTSIDE} b/${OUTSIDE}\n` +
      `--- a/${OUTSIDE}\n+++ b/${OUTSIDE}\n@@ -1 +1 @@\n-old\n+new\n*** End Patch`,
    expect: [OUTSIDE],
  },
  {
    // Models mirror the leading `***`; the parser tolerates it, so the scanner must not
    // hand the gate a path with the asterisks still attached (it would judge a path the
    // applier never touches, and glob-based deny rules would miss the real one).
    label: 'mirrored trailing asterisks',
    patch: `*** Begin Patch\n*** Update File: ${OUTSIDE} ***\n@@\n-old\n+new\n*** End Patch`,
    expect: [OUTSIDE],
  },
]

describe('patchTargetPaths agrees with the parser on every dialect', () => {
  for (const { label, patch, expect: wanted } of DIALECTS) {
    test(`${label}: the gate sees what the applier writes`, () => {
      // The parser is the authority — it is what the applier runs on.
      const parsed = parsePatchText(patch).map((file) => file.path)
      expect({ label, parsed }).toMatchObject({ label })
      expect(parsed).toEqual(wanted)
      // The scanner must not be narrower.
      expect(patchTargetPaths(patch).sort()).toEqual([...wanted].sort())
    })
  }
})

describe('the outside-workspace prompt cannot be dodged by dialect', () => {
  const cwd = '/tmp/localix-workspace-fixture'

  for (const { label, patch } of DIALECTS) {
    test(`${label}: outsideWorkspace is true`, () => {
      // The end-to-end assertion: this fact is what the default
      // `{permission:'mutates', pattern:'outside-workspace', action:'ask'}` rule reads.
      // Real signature: (toolName, input, root) — `cwd` travels INSIDE the input, the
      // way every production caller passes it.
      const facts = extractCallFacts('apply_patch', { patch, cwd }, cwd)
      expect({ label, outsideWorkspace: facts.outsideWorkspace }).toEqual({
        label,
        outsideWorkspace: true,
      })
      expect(facts.outsidePaths.length).toBeGreaterThan(0)
    })
  }

  test('a patch INSIDE the workspace still does not ask', () => {
    // The guard must not become "always prompt" — that trains the user to click through.
    const facts = extractCallFacts(
      'apply_patch',
      { patch: '*** Begin Patch\n*** Add File: src/new.ts\n+export {}\n*** End Patch', cwd },
      cwd,
    )
    expect(facts.outsideWorkspace).toBe(false)
    expect(facts.outsidePaths).toEqual([])
  })
})
