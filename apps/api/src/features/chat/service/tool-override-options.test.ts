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

// skills.md, "Available string substitutions": `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}`
// (and, in a plugin skill, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`) are substituted in
// Bash rules of `allowed-tools`, so a skill can run its own bundled script without a prompt.
describe('toolOverrideOptions ${CLAUDE_*} path variables', () => {
  it('fills the skill directory and the plugin paths into allowed-tools', () => {
    const out = toolOverrideOptions(
      {
        allowedTools: [
          'Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)',
          'Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh:*)',
          'Read(${CLAUDE_PLUGIN_DATA}/**)',
        ],
      },
      {
        CLAUDE_PROJECT_DIR: '/work',
        CLAUDE_SKILL_DIR: '/skills/render-chart',
        CLAUDE_PLUGIN_ROOT: '/plugins/ralph',
        CLAUDE_PLUGIN_DATA: '/data/ralph',
      },
    )
    expect(out?.extraAllowedTools).toEqual([
      'Bash(/skills/render-chart/scripts/render.sh *)',
      'Bash(/plugins/ralph/scripts/setup.sh:*)',
      'Read(/data/ralph/**)',
    ])
  })
})
