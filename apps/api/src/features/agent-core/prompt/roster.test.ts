import { describe, expect, test } from 'bun:test'
import { resolveRunProfile } from '../run-shape'
import {
  fullPrompt,
  richRegistry,
  SHAPE_SESSION_KIND,
  type PromptShapeKey,
} from './testing/prompt-render'

/**
 * The `# Available tools` roster and the registry the agent actually gets are built
 * from different code paths (`run-shape` exposure vs `tool-registry` optionals).
 * A drift either way is silent and expensive: a tool named in the prompt but absent
 * from the registry makes the model call something that does not exist (a wasted turn
 * plus an error it must recover from), and a registered tool the prompt never names is
 * dead code the model will not discover.
 */
const rosterOf = (prompt: string): string[] => {
  const section = prompt.split('# Available tools')[1]?.split('\n# ')[0] ?? ''
  return [...section.matchAll(/^- ([a-z_0-9]+)$/gm)].map((m) => m[1])
}

const PROFILES = Object.keys(SHAPE_SESSION_KIND) as PromptShapeKey[]

describe('system prompt roster matches the tool registry', () => {
  // SCAN LIVENESS. Every assertion below is registered FROM this matrix, and a suite that
  // registers no tests is green: emptying the matrix once left the file at 1 test / 0 fail
  // while the roster↔registry comparison ran for nothing (mutation-verified). "The scan
  // found no drift" is only evidence if the scan happened.
  test('the matrix is non-empty — a guard that registers no tests detects nothing', () => {
    expect(PROFILES.length).toBeGreaterThan(0)
  })

  for (const key of PROFILES) {
    test(key, () => {
      const registered = richRegistry(
        resolveRunProfile({ sessionKind: SHAPE_SESSION_KIND[key] }),
      ).toolNames
      const listed = rosterOf(fullPrompt(key))
      expect([...listed].sort()).toEqual([...registered].sort())
    })
  }
})
