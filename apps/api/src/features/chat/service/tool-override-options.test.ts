import { describe, it, expect } from 'bun:test'
import { toolOverrideOptions } from './tool-override-options'

describe('toolOverrideOptions ${CLAUDE_PROJECT_DIR} substitution', () => {
  it('returns undefined when neither list is set', () => {
    expect(toolOverrideOptions({})).toBeUndefined()
  })

  it('substitutes ${CLAUDE_PROJECT_DIR} in allowed-tools values (v2.1.196)', () => {
    const out = toolOverrideOptions(
      { allowedTools: ['Bash(${CLAUDE_PROJECT_DIR}/scripts/lint.sh *)', 'read'] },
      '/work/project',
    )
    expect(out?.extraAllowedTools).toEqual(['Bash(/work/project/scripts/lint.sh *)', 'read'])
  })

  it('substitutes in disallowed-tools too, and leaves values untouched without a projectDir', () => {
    expect(
      toolOverrideOptions({ disallowedTools: ['Bash(${CLAUDE_PROJECT_DIR}/x *)'] }, '/p')!
        .extraDisabledTools,
    ).toEqual(['Bash(/p/x *)'])
    // No projectDir → verbatim.
    expect(
      toolOverrideOptions({ allowedTools: ['Bash(${CLAUDE_PROJECT_DIR}/x)'] })!.extraAllowedTools,
    ).toEqual(['Bash(${CLAUDE_PROJECT_DIR}/x)'])
  })
})
