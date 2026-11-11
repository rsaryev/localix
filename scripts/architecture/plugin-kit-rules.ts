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
 *
 * The markers match the code with its backslash escapes removed, so a marker written inside a
 * regular expression (`/user_config\./`, `/\$\{CLAUDE_PLUGIN_ROOT\}/`) counts like a string.
 * A bare `${NAME}` is not a marker: Localix's own formats (a mini app manifest, the model catalog,
 * an `.npmrc`) use it too. The `${VAR:-default}` form with a captured name is Claude Code's
 * expansion of MCP and plugin settings, and is one.
 */
const MARKERS = [
  { name: '$ARGUMENTS', pattern: /\$ARGUMENTS/u, what: 'skill arguments' },
  { name: 'CLAUDE_SKILL_DIR', pattern: /CLAUDE_SKILL_DIR/u, what: 'skill variables' },
  { name: '${CLAUDE_PLUGIN_ROOT}', pattern: /\$\{CLAUDE_PLUGIN_ROOT\}/u, what: 'path variables' },
  { name: 'CLAUDE_PLUGIN_DATA', pattern: /CLAUDE_PLUGIN_DATA/u, what: 'plugin variables' },
  { name: 'CLAUDE_PROJECT_DIR', pattern: /CLAUDE_PROJECT_DIR/u, what: 'hook variables' },
  { name: 'CLAUDE_ENV_FILE', pattern: /CLAUDE_ENV_FILE/u, what: 'hook env files' },
  { name: '${VAR:-default}', pattern: /\$\{[^\n/]{0,60}\(\?::-/u, what: 'variable expansion' },
  { name: 'user_config.', pattern: /user_config\./u, what: 'user config references' },
  { name: 'hookSpecificOutput', pattern: /hookSpecificOutput/u, what: 'hook output' },
  { name: 'permissionDecision', pattern: /permissionDecision\b/u, what: 'hook decisions' },
  { name: 'hooks.json', pattern: /hooks\.json/u, what: 'hooks reading' },
  { name: 'disable-model-invocation', pattern: /disable-model-invocation/u, what: 'frontmatter' },
  { name: 'allowed-tools', pattern: /allowed-tools/u, what: 'frontmatter' },
  { name: 'SKILL.md', pattern: /SKILL\.md/u, what: 'skill reading' },
  { name: 'plugin.json', pattern: /plugin\.json/u, what: 'manifest reading' },
  { name: '.mcp.json', pattern: /\.mcp\.json/u, what: 'MCP config reading' },
  { name: 'headersHelper', pattern: /headersHelper/u, what: 'MCP headers helper' },
  { name: 'force-for-plugin', pattern: /force-for-plugin/u, what: 'plugin settings' },
] as const

/** The code with every backslash escape reduced to the character it escapes. */
const unescaped = (code: string) => code.replace(/\\(.)/gsu, '$1')

const SEMANTICS_SCOPES = ['apps/api/src/', 'apps/ui/src/', 'packages/']

export const X6_PLUGIN_SEMANTICS_IN_THE_KIT: Rule = {
  id: 'X6',
  fix: `ask the kit through ${BOUNDARY}index.ts (reader, substitution, hook verdict, rule match) instead of spelling the format here`,
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!SEMANTICS_SCOPES.some((root) => source.file.startsWith(root))) continue
      if (source.file.startsWith(BOUNDARY) || isTest(source.file)) continue
      const code = unescaped(source.code)
      for (const marker of MARKERS)
        if (marker.pattern.test(code))
          found.push(`${source.file} spells ${marker.name} (${marker.what})`)
    }
    return found
  },
}

/**
 * X7: only the boundary runs the kit, tests included, so a kit behaviour Localix depends on lands in
 * one folder. Its TYPES are the one definition of the format's shapes everywhere: a file outside the
 * boundary names them with `import type` straight from the kit's public entries (never a Localix
 * look-alike, never a re-export), and only the boundary imports a value or re-exports. The UI may
 * import the subpaths that are plain data or elements a screen renders (an elicitation form, the
 * standard layout, the elements a mod's view is made of).
 */
const UI_SUBPATHS = new Set([`${KIT}/elicitation`, `${KIT}/layout`, `${KIT}/mods/elements`])
const isKit = (spec: string) => spec === KIT || spec.startsWith(`${KIT}/`)

export const X7_KIT_THROUGH_THE_BOUNDARY: Rule = {
  id: 'X7',
  fix: `name a kit type with \`import type\` from ${KIT}; call a kit value through ${BOUNDARY}index.ts, adding it there when it is missing`,
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (source.file.startsWith(BOUNDARY)) continue
      const ui = source.file.startsWith('apps/ui/')
      for (const { spec, typeOnly, kind } of importsOf(source)) {
        if (!isKit(spec) || (ui && UI_SUBPATHS.has(spec))) continue
        if (kind === 'import' && typeOnly) continue
        found.push(`${source.file} ${kind === 'export' ? 're-exports' : 'imports'} ${spec}`)
      }
    }
    return found
  },
}
