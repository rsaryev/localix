import type { Kit } from '../kit/kit'
import { AGENT_PARTNERSHIP, APP_LAYER, BEYOND_COLLECTIONS, DESIGN_BRIEF } from './contract'
import { copyDomain, fillPlaceholders, type TemplateScaffold } from './template-layout'

/**
 * What a fresh mini app is TOLD: its README, its AGENTS.md and the instruction `mini-app create`
 * prints for the agent. Every file list and identifier comes from the template's own
 * `scaffold.json` and the kit, never retyped here; the SDK contract is `./contract`.
 *
 * None of it names a directory outside the mini app: the only path an agent is given is the mini
 * app's own, the only way to check and build it is this toolchain's `mini-app` command, and the
 * only way to look at it is the browser on the mini app's view inside Localix.
 */

/** The kit catalog, copied into every mini app beside its generated `tsconfig.json`. */
export const KIT_CATALOG_FILE = 'KIT.md'
/** Where a build puts the backend bundle inside the package. */
const BACKEND_OUT_DIR = 'dist/backend'

/** A mini app's view as a browser target inside Localix. */
export const miniAppViewTarget = (name: string) => `mini-app:${name}`

/** What the backend and the screen may import; nothing else resolves. */
function importsLine(kit: Kit, catalog: boolean): string {
  return `Imports: the backend may use ${kit.manifest.authoring.backendSharedModules.join(', ')}, node:*, bun:* and its own files; tests also @localixai/mini-app-sdk/backend/testing. The screen may use React, zod, lucide-react, @localixai/mini-app-sdk/ui* (not /ui/testing) and the host kit \`@localixai/kit/<id>\`${catalog ? ` — the ids ${KIT_CATALOG_FILE} lists` : ` — ids: ${kit.manifest.kitModules.join(', ')}`}. Nothing else resolves. Everything you need is in this folder and this message; do not search the disk for SDK or kit sources.`
}

export function readme(input: {
  name: string
  displayName: string
  description: string
  scaffold: TemplateScaffold
}): string {
  return `# ${input.displayName}

${input.description}

Created from the ${input.scaffold.domainName} reference mini app. \`shared/\` holds the data and the
logic both sides share, \`backend/\` its collections and the agent's tools, \`ui/\` its screen, and
\`guide.md\` what the agent reads before it first uses the app. The plumbing between them — routes,
storage, live updates, search — is the SDK's.

\`mini-app check\` runs every check; \`mini-app build\` also packages it into \`dist/package/\`, and
\`mini-app install\` puts that package into a running Localix, which swaps it in place. Open
**${input.displayName}** from the workspace overflow menu or the command palette. \`mini-app pack\`
makes a catalog to share it.
`
}

export function agentsMd(input: {
  name: string
  displayName: string
  kit: Kit
  scaffold: TemplateScaffold
}): string {
  const { name, displayName, kit, scaffold } = input
  return `# Working on ${displayName}

This folder is the mini app's source; nothing here is installed with a package manager.
\`mini-app check\` runs every check, \`mini-app build\` also packages it into \`dist/package/\`, and
\`mini-app install\` puts the package into a running Localix. Inside Localix, look at the result
with the Browser tool on \`${miniAppViewTarget(name)}\`; the workbench replaces the UI in place.

${AGENT_PARTNERSHIP}

${APP_LAYER}

${BEYOND_COLLECTIONS}

${DESIGN_BRIEF}

House rules:

- The entries keep their path and export: ${scaffold.entry.join(', ')}. \`mini-app.json\` names the
  app, its settings (\`config\`) and its backend (\`./backend/index.ts\`; the package's copy names its
  bundle under \`${BACKEND_OUT_DIR}/\`). \`guide.md\` tells the agent which tool does what and what to
  tell the person. A mini app holds no Claude Code plugin — no \`skills/\`, \`.claude-plugin/\` or hooks.
- What the template's own domain was (${copyDomain(scaffold, name).join(', ')}) is replaced by this
  app's; \`mini-app check\` names any of it that is left.
- Build every control from the kit and colour with host tokens; \`mini-app check\` reports a raw
  \`<button>\` or a palette class with its line. \`${KIT_CATALOG_FILE}\` lists each kit module by the
  job it does — look there before writing a control. No file over 300 lines.
- Every contributed id stays namespaced \`${name}:\`; tool names stay unique across mini apps.
- \`tsconfig.json\` and \`${KIT_CATALOG_FILE}\` are written by every check; do not edit them. The SDK's
  declarations under the \`paths\` of \`tsconfig.json\` are the contract of every call above, and you
  may read them.

${importsLine(kit, Boolean(kit.manifest.authoring.catalog))}
`
}

/** The template's files named after its own items, which a copy replaces rather than edits. */
function domainNamedFiles(scaffold: TemplateScaffold): string[] {
  const named = new RegExp(scaffold.domainNamedPaths.join('|'), 'iu')
  const files = [...scaffold.domain, ...scaffold.patterns.map((p) => p.file)]
  return files.filter(
    (file, i) => !file.endsWith('/') && named.test(file) && files.indexOf(file) === i,
  )
}

/** The agent turn that turns a fresh copy into the mini app the person asked for. */
export function agentInstruction(input: {
  name: string
  displayName: string
  description: string
  dir: string
  kit: Kit
  scaffold: TemplateScaffold
}): string {
  const { name, displayName, description, dir, kit, scaffold } = input
  const fill = (text: string) => fillPlaceholders(text, { name, displayName })
  const catalog = Boolean(kit.manifest.authoring.catalog)
  // The catalog answers WHICH module a job needs; the digest answers what the core ones take.
  const digest = kit.manifest.kitDigest?.length
    ? ['The core controls and the props they take:', ...kit.manifest.kitDigest.map((l) => `  ${l}`)]
    : []
  const at = (file: string) => `${dir}/${file}`
  return [
    `A new Localix mini app "${displayName}" (${name}) exists at ${dir}: a working, renamed copy of the ${scaffold.summary}, with the tools ${scaffold.tools.map(fill).join(', ')}. Work only inside ${dir}, and name every file by its full path there.`,
    `Goal: make it do this instead — ${description}`,
    AGENT_PARTNERSHIP,
    // A copy asked for a GitHub tracker stopped twice before the person had anything, and a meal
    // tracker started a checking subagent before any code existed and steered it mid-run. The
    // person waits on every stop and every round trip.
    'Deliver a working, good-looking app in this one turn: do the steps below without ending your turn before the last. Build the smallest version that does what was asked end to end, on real data. A choice with a sensible default is yours — make it and name it at the end; ask only what no default can answer. Do it yourself: a subagent started before shared/model.ts exists works against a contract that is not there, and a review is not a step. Each tool call is a model round trip, so batch: read together, write independent files together, check once the whole app is written.',
    [
      'Steps:',
      `1. READ in one batch: ${[
        'mini-app.json',
        'guide.md',
        ...scaffold.patterns.map((p) => p.file),
      ]
        .filter((f, i, all) => all.indexOf(f) === i && f !== 'icon.svg')
        .map(at)
        .join(
          ', ',
        )}. They are short and each is the pattern for its part. Nothing else: AGENTS.md repeats this message, and ${KIT_CATALOG_FILE} is searched for a job, not read whole.`,
      ...scaffold.patterns.map((p) => `   - ${p.use}: ${p.file} (at "${p.anchor}")`),
      `2. DECIDE, before writing: the items and their fields, the tools the agent needs (one per thing the person does), what the screen shows first (the hero number), and the defaults. Then write ${at('shared/model.ts')} — schemas and pure logic — first.`,
      `3. WRITE the rest in one batch: the collection spec, tools and register in backend/, the screen in ui/App.tsx and ui/parts/, ui/register.tsx (title, Icon, agentContext with the tool names), mini-app.json (description, category, tags, config) and guide.md. Name each new file after what it holds (backend/<items>.ts, ui/parts/<Item>List.tsx) and import it by that name; in the same batch remove the ${scaffold.domainName} files named after its items — ${domainNamedFiles(scaffold).map(at).join(', ')} — with one rm. Never mv a template file after writing into it: its importers keep the old path. No identifier of the old domain may survive (${scaffold.domainTokens.slice(0, 3).map(fill).join(', ')}, …). README.md and AGENTS.md are written; leave them.`,
      `4. TEST with bun:test: each tool through callTool, the screen's routes through requestRoute, and the shared logic directly. Then draw the icon: mini-app icon ${dir} --glyph '<path d="…"/>'.`,
      `5. CHECK with \`mini-app check ${dir}\`: leftovers, house style, both builds, types against the SDK and kit, tests — every problem one line with its file:line, all in one report. Fix them all, then check again.`,
      `6. INSTALL with \`mini-app install ${dir}\`: it builds the package and puts it into the running Localix. Without Localix on this computer, \`mini-app build ${dir}\` leaves the package in ${dir}/dist/package and \`mini-app get-localix\` installs Localix — say so instead.`,
      `7. LOOK, if the Browser tool is available (inside Localix): url "${miniAppViewTarget(name)}" opens its view; take_screenshot, and do each thing the person will do. Fix what does not look or work right, check and install again. Otherwise say that visual checks were not run.`,
      `8. TELL the person "${displayName}" is in Localix's workspace overflow menu, what it does, what to say or attach in the chat to use it, and the defaults you chose. Nothing needs a restart. Offer two or three next steps, most useful first.`,
    ].join('\n'),
    APP_LAYER,
    BEYOND_COLLECTIONS,
    DESIGN_BRIEF,
    [
      `Look like Localix: build every control from the kit — never a raw <button>, <input>, <select> or <textarea>. Colour with host tokens — text-foreground, text-text-soft, text-text-faint, border-border, bg-surface-hover, text-status-error|warning|success|info — never a palette class such as text-red-500 or a hex colour; radius rounded-md or rounded-lg. No second theme, no pane-sized background, no file over 300 lines. Keep every contributed id prefixed "${name}:" and every tool name unique across mini apps.`,
      catalog
        ? `${KIT_CATALOG_FILE} in the mini app folder lists every kit module by the job it does (tabs, tables, empty states, charts, dialogs…): before writing any control, find its job there and use that module.`
        : '',
      ...digest,
    ]
      .filter(Boolean)
      .join('\n'),
    importsLine(kit, catalog),
  ].join('\n\n')
}
