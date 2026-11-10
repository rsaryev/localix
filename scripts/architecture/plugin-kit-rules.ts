import { importsOf, isTest, type Rule } from './kit'

/**
 * X6 and X7 (`docs/internals/plugins-and-mini-apps.md`): what a Claude Code plugin means comes
 * from `@rsaryev/llx-plugin`, and only through one folder of the API.
 */
const BOUNDARY = 'apps/api/src/features/plugins/kit/'
const KIT = '@rsaryev/llx-plugin'

/**
 * X6: a source file that spells one of these markers in code (strings included, comments not)
 * reimplements a piece of the format: how a plugin is read, its variables substituted, a hook's
 * output judged or a frontmatter field honoured. The boundary asks the kit instead; tests and
 * testing helpers may spell them to build fixtures. The baseline lists the code that still does,
 * and it only shrinks as each piece moves behind the boundary.
 */
const MARKERS = [
  { name: '$ARGUMENTS', pattern: /\$ARGUMENTS/u, what: 'skill arguments' },
  { name: 'CLAUDE_SKILL_DIR', pattern: /CLAUDE_SKILL_DIR/u, what: 'skill variables' },
  { name: '${CLAUDE_PLUGIN_ROOT}', pattern: /\$\{CLAUDE_PLUGIN_ROOT\}/u, what: 'path variables' },
  { name: 'CLAUDE_PLUGIN_DATA', pattern: /CLAUDE_PLUGIN_DATA/u, what: 'plugin variables' },
  { name: 'user_config.', pattern: /user_config\./u, what: 'user config references' },
  { name: 'hookSpecificOutput', pattern: /hookSpecificOutput/u, what: 'hook output' },
  { name: 'permissionDecision', pattern: /permissionDecision\b/u, what: 'hook decisions' },
  { name: 'disable-model-invocation', pattern: /disable-model-invocation/u, what: 'frontmatter' },
  { name: 'allowed-tools', pattern: /allowed-tools/u, what: 'frontmatter' },
  { name: 'plugin.json', pattern: /plugin\.json/u, what: 'manifest reading' },
] as const

const SEMANTICS_SCOPES = ['apps/api/src/', 'apps/ui/src/', 'packages/']

export const X6_PLUGIN_SEMANTICS_IN_THE_KIT: Rule = {
  id: 'X6',
  fix: `ask the kit through ${BOUNDARY}index.ts (reader, substitution, hook verdict, rule match) instead of spelling the format here`,
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!SEMANTICS_SCOPES.some((root) => source.file.startsWith(root))) continue
      if (source.file.startsWith(BOUNDARY) || isTest(source.file)) continue
      for (const marker of MARKERS)
        if (marker.pattern.test(source.code))
          found.push(`${source.file} spells ${marker.name} (${marker.what})`)
    }
    return found
  },
}

/**
 * X7: only the boundary imports the kit, tests included, so the rest of Localix depends on what
 * the boundary exports and a kit change lands in one folder. The UI may import the subpaths that
 * are plain data or elements a screen renders (an elicitation form, the standard layout, the
 * elements a mod's view is made of).
 */
const UI_SUBPATHS = new Set([`${KIT}/elicitation`, `${KIT}/layout`, `${KIT}/mods/elements`])
const isKit = (spec: string) => spec === KIT || spec.startsWith(`${KIT}/`)

export const X7_KIT_THROUGH_THE_BOUNDARY: Rule = {
  id: 'X7',
  fix: `import what you need from ${BOUNDARY}index.ts; add it there when it is missing`,
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (source.file.startsWith(BOUNDARY)) continue
      const ui = source.file.startsWith('apps/ui/')
      for (const { spec } of importsOf(source))
        if (isKit(spec) && !(ui && UI_SUBPATHS.has(spec)))
          found.push(`${source.file} imports ${spec}`)
    }
    return found
  },
}
