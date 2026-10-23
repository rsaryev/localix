import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The composer AUTHORS no tip.
 *
 * Tips used to be a curated list in this folder. It named plugins ("the Playwright
 * plugin"), tools ("bash") and slash commands — none of which the client can check
 * are present in the workspace it is running against, and the last of which the
 * parser is free to rename underneath it. The whole pool is composed on the server
 * now, from that scope's catalogs and the shared slash-command catalog; these modules
 * only decide WHEN a tip shows and WHICH of the eligible ones it is.
 *
 * The rule that keeps it that way: no tip TEXT is written here. A tip is the only
 * thing in these files that would need a sentence-shaped string literal, so that is
 * what the detector looks for.
 */

const TIP_SOURCES = ['streamTips.ts', 'tipSelection.ts', 'useComposerTips.ts']

/** Strip comments — prose belongs there, sentences in code are the thing at issue. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * String literals long enough to be a tip. A short literal is a key or a class name;
 * a sentence is content, and content belongs to the server.
 */
function sentenceLiterals(source: string): string[] {
  return (code(source).match(/'[^'\n]{40,}'|"[^"\n]{40,}"/g) ?? []).filter((literal) =>
    /\s\w+\s\w+\s/.test(literal),
  )
}

describe('the composer authors no tip text', () => {
  for (const file of TIP_SOURCES) {
    test(`${file} contains no tip copy`, () => {
      expect(sentenceLiterals(readFileSync(join(import.meta.dir, file), 'utf8'))).toEqual([])
    })
  }

  // Positive control: the detector is only worth its test if it would fire.
  test('the detector catches a planted tip', () => {
    const planted = `const tip = { text: 'Enable the browser plugin so the agent can click.' }`
    expect(sentenceLiterals(planted)).toHaveLength(1)
  })
})
