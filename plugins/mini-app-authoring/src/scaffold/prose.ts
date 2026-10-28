import type { Kit } from '../kit/kit'
import {
  copyDomain,
  fillPlaceholders,
  listFiles,
  templateFrame,
  type TemplateScaffold,
} from './template-layout'

/**
 * What a fresh mini app is TOLD: its README, its AGENTS.md and the instruction `mini-app create`
 * prints for the agent. Every file list and identifier comes from the template's own
 * `scaffold.json` and the kit, never retyped here.
 *
 * None of it names a directory outside the mini app: the only path an agent is given is the mini
 * app's own, the only way to check and build it is this toolchain's `mini-app` command, and the
 * only way to look at it is the browser on the mini app's view inside Localix.
 *
 * The instruction states each CONTRACT the copy has to meet, because a generated mini app broke every one it
 * was only told in outline: `executionMode: 'serial'` and `execute(input)` for its first acting
 * tool, a click answer kept beside the polled snapshot (the countdown froze), hand-rolled buttons
 * in palette colours, and a result it never looked at.
 */

/** The kit catalog, copied into every mini app beside its generated `tsconfig.json`. */
export const KIT_CATALOG_FILE = 'KIT.md'
/** Where a build puts the backend bundle inside the package. */
const BACKEND_OUT_DIR = 'dist/backend'

/** A mini app's view as a browser target inside Localix. */
export const miniAppViewTarget = (name: string) => `mini-app:${name}`

function frameList(kit: Kit, scaffold: TemplateScaffold): string[] {
  return templateFrame(scaffold, listFiles(kit.templateDir))
}

/**
 * How a view hears that something changed. Told only of the polling hook, a copy polls for state
 * the backend could have announced (a board polled every 800 ms to see the agent's move, and still
 * showed it a poll late), and a backend that watches files with `node:fs.watch` misses part of
 * every burst on macOS. So the push paths come first and a poll is named for what it is: the
 * backstop.
 */
export const LIVE_DATA_CONTRACT =
  "- Changes are PUSHED, not polled. State in openJsonStore: read it with ui/useStoreSnapshot.ts, which backend/store-feed.ts nudges. Any other live data: a wsFrames entry in the backend (subscribeCommand, unsubscribeCommand, frameTag — one lowercase letter, not s, r or n — and start(params, send, { userId })), followed in the view with createRealtimeFeed and useRealtimeFeed from @localixai/mini-app-sdk/ui/realtime-feed, which share one subscription per key, resubscribe after a reconnect and say whether the stream is live. Files in the chat's workspace: useMiniAppWorkspaceChanges(sessionId, onChange) from @localixai/mini-app-sdk/ui/runtime-hooks. A backend that watches files uses ctx.watchPath(path, recursive, onEvent, onError), never node:fs.watch: Bun's recursive fs.watch on macOS drops part of a burst. Use the SDK file/store read coordinator. Poll only while push coverage is unavailable, or for a named source it cannot cover; a healthy fully covered resource has no timer."

/**
 * What a mini app is FOR, said before how to build one. Told only the template's mechanics, a copy
 * asked for "calories from a photo" stopped to report that the mini app kit has no image upload or
 * vision API, and proposed wiring a recognition service into the mini app — while the agent reading
 * that instruction could see the photo itself. In Localix the mini app never works alone: the chat
 * agent is always beside it, and it is the mini app's intelligence. So the mini app keeps state, shows
 * it and exposes tools; understanding what the person sends is the agent's.
 */
export const AGENT_PARTNERSHIP =
  "How a Localix mini app works: it is never used alone. Beside every mini app is the chat with the agent — you, now — which is multimodal and capable: it reads the photos, screenshots, PDFs and files the person attaches in chat, understands free text in any language, knows the world, searches the web, and calls every enabled mini app's tools. So the MINI APP keeps the state, shows it and gives the agent tools to read and change it; the AGENT does the understanding. Do not build into the mini app what the agent already does: no image or file upload, no model, vision, OCR or LLM API call, no parsing of free text, no API keys, no integration the agent can reach itself. Design the tools for the agent to fill: structured input it extracts from what the person sent (a meal photo becomes log_meal({ items: [{ name, grams, kcal, protein, fat, carbs }], confidence, note })), with the mini app validating, storing and summing. The view shows and edits that state, and its empty state tells the person what to do in chat (\"attach a photo of your meal in chat and ask to log it\"). A control that needs judgment wakes the agent (ctx.host.wake, below) instead of thinking itself; only a small pick the mini app makes on its own, often, uses the host's models (ctx.host.semantic.rank, ctx.host.decisions — below), never a model of its own. The mini app's skill teaches the agent this loop: what to extract from a message, which tool takes it, what to tell the person after. Never stop to ask how the mini app should reach a model or an image: you are that model, in the chat it lives beside."

/**
 * The host's models, for the one kind of judgment a mini app makes itself: small, frequent picks
 * (which column, which of a few options, the same item twice) where waking the agent is too slow
 * and too costly. Both are the host's own APIs; the mini app names no model
 * and holds no key, and keeps its own fallback because either may not answer.
 */
export const HOST_JUDGMENT_CONTRACT =
  "- For a small pick the mini app makes itself, often — which column a card belongs in, the nearest of a few options, the same item twice — use the host's models, never one of your own (backend only, like wake). ctx.host.semantic.rank(query, [{ key, text }], { task: 'classification' }) ranks candidates nearest first with the embedding model on this computer: free, and null until the model is ready. ctx.host.decisions.decide(userId, { state, questions: { column: { type: 'choice', instructions, criteria: { todo: 'Not started', done: 'Finished' } } } }, { purpose: 'triage', sessionId }) asks a decision model typed questions ('choice' picks an option key, 'bool' gives a probability) and bills the person's chat; read a pick with confidentChoice(answer, 0.8) from @localixai/mini-app-sdk/backend. It answers status 'answered' with answers, or why not (unavailable, deadline, cancelled, failed): keep the mini app's own fallback for every outcome. Understanding what the person sends stays the agent's."

/** The frame's shared helpers, named by what they are for. */
const FRAME_HELPERS = [
  'ui/usePolledSnapshot.ts — read a route while the view is visible, and send(body, { path?, method? }) for every action: the route answers with the NEW state, which replaces the snapshot at once',
  'ui/useStoreSnapshot.ts — the same for state openJsonStore keeps: re-read the moment backend/store-feed.ts (createStoreFeed, registered as wsFrames) nudges the scope, polling only as a slow backstop',
  'ui/useNow.ts — the SDK clock (@localixai/mini-app-sdk/ui/now) for anything that counts; derive the value from a stored timestamp',
  'backend/store.ts — openJsonStore({ dir: ctx.dataDir, file, schema, initial }): durable state, one change at a time, shared by every register(ctx) call',
]

export function readme(input: {
  name: string
  displayName: string
  description: string
  scaffold: TemplateScaffold
}): string {
  return `# ${input.displayName}

${input.description}

Created from the ${input.scaffold.domainName} reference mini app. The frame (registration entry,
read and action hooks, store feed, clock, durable store, backend shape) is shared with every copy; the domain
under \`shared/\`, \`backend/\` and \`ui/\`, and the agent's guide (\`guide.md\`), are this mini app's own.

\`mini-app build\` checks it and packages it into \`dist/package/\`: the backend bundled, the workbench UI
built. \`mini-app install\` puts that package into a running Localix, which swaps it in place; open
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
\`mini-app install\` puts the package into a running Localix.

The mini app keeps state, shows it and gives the chat agent tools; the agent — always beside it,
multimodal — does the understanding. Photos, files and free text arrive in chat, the agent extracts
structured data and calls the mini app's tools. Never build uploads, model/vision/LLM calls, text
parsing or API keys into the mini app; a control that needs judgment wakes the agent.

${HOST_JUDGMENT_CONTRACT}

- KEEP the frame (${frameList(kit, scaffold).join(', ')}). It imports no domain module; it reaches
  the domain only through the entries.
- EDIT the entries, keeping their path and export: ${scaffold.entry.join(', ')}.
- REPLACE the domain — delete it, or rename it after what it now holds: ${copyDomain(scaffold, name).join(', ')}.
- One manifest: \`mini-app.json\` (name, description, category, settings, commands, the backend),
  and \`guide.md\`, which the agent reads with \`MiniAppGuide\` before it first uses the app:
  which tool does what, and what to tell the person. A mini app holds no Claude Code plugin — no
  \`skills/\`, \`.claude-plugin/\` or hooks. \`backend\` names the source entry,
  \`./backend/index.ts\`; the package's copy names its bundle under \`${BACKEND_OUT_DIR}/\`.
- Keep what the user creates with \`openJsonStore\` (\`backend/store.ts\`) under \`ctx.dataDir\`,
  given to \`register(ctx)\`; \`ctx.stateDir\` is for internal state. Never only in memory.
- Act through \`ui/usePolledSnapshot.ts\`: \`send()\` for every action, never a second copy of the
  state beside the snapshot, never a second timer or \`visibilitychange\` listener. Anything that
  counts is derived from a timestamp with \`ui/useNow.ts\`.
- Hear changes instead of polling for them. State in \`openJsonStore\` is read with
  \`ui/useStoreSnapshot.ts\`, which \`backend/store-feed.ts\` nudges; any other live data is a
  \`wsFrames\` entry followed with \`createRealtimeFeed\`/\`useRealtimeFeed\`
  (\`@localixai/mini-app-sdk/ui/realtime-feed\`); workspace files with \`useMiniAppWorkspaceChanges\`. A
  backend watches files with \`ctx.watchPath\`, never \`node:fs.watch\` (Bun's recursive watch on
  macOS drops bursts). A poll is only the slow backstop.
- A tool is \`ctx.defineTool({ …, inputSchema: ctx.z.object({…}), executionMode: 'parallel' |
  'sequential', mutates, classify, async execute(_toolCallId, input) { … } })\`. \`classify\` names
  where each call lands (\`read\`, \`view\`, \`session\`, \`files\`, \`host\`, \`external\`); without it every
  call of a \`mutates\` tool counts as \`external\` and a read-only session refuses even its reads.
  For an \`action\` enum use \`classifyByAction\` from \`@localixai/mini-app-sdk/backend\`; a tool
  without an \`action\` field gets a constant (\`classify: () => ({ effect: 'read' })\`).
- A \`toMessageBinding\` to a resource URI needs a backend \`resourceProvider\` that expands it;
  without one, drop the binding and publish the visible state with \`publishMessageContext\`.
- The backend may import ${kit.manifest.authoring.backendSharedModules.join(', ')}, \`node:*\`, \`bun:*\` and its own files.
  The UI may import React, \`zod\`, \`lucide-react\`, \`@localixai/mini-app-sdk/ui*\` (not \`/ui/testing\`)
  and the host kit \`@localixai/kit/<id>\`. Nothing else is available.
- Build every control from the kit and colour with host tokens; \`mini-app check\` reports a raw
  \`<button>\` or a palette class with its line. \`${KIT_CATALOG_FILE}\` (written by every check, like
  \`tsconfig.json\`) lists each kit module by the job it does — look there before writing a control.
- Every contributed id stays namespaced \`${name}:\`; tool names stay unique across mini apps.
- Check with \`mini-app check\`, then \`mini-app install\` to build it into Localix; inside Localix
  look at the result with the Browser tool on \`${miniAppViewTarget(name)}\`. The running workbench
  replaces the UI in place; nothing needs a restart.
- \`tsconfig.json\` is generated by every check (it points at the SDK and kit declarations in the
  kit); the editor's diagnostics read it, so they match what the check reports. Do not edit it.
- The SDK's declarations are the contract of every \`ctx\` API, and you may read them (read and
  search only): the \`.d.ts\` files under the \`paths\` of \`tsconfig.json\`, such as the one for
  \`@localixai/mini-app-sdk/backend\`. Look there for \`ctx.host.semantic\` (index your items,
  query by meaning, \`rank\`), \`ctx.host.decisions\` (typed questions to a decision model) and
  \`ctx.host.wake\` before hand-rolling any of them.
`
}

/** The agent turn that turns a fresh copy into the mini app the user asked for. */
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
  const view = miniAppViewTarget(name)
  // The catalog answers WHICH module a job needs; the digest answers what the core ones take.
  // Told the props alone, a copy hand-rolled the tabs, checkbox and progress bar the kit had.
  const catalog = kit.manifest.authoring.catalog
    ? `${KIT_CATALOG_FILE} in the mini app folder lists every kit module by the job it does (tabs, trees, tables, empty states, charts, dialogs…): before writing any control, find its job there and use that module.`
    : ''
  const digest = kit.manifest.kitDigest?.length
    ? [
        'The core controls and the props they take:',
        ...kit.manifest.kitDigest.map((line) => `  ${line}`),
      ].join('\n')
    : ''
  return [
    `A new Localix mini app "${displayName}" (${name}) exists at ${dir}: a renamed copy of the ${scaffold.summary}, with the tools ${scaffold.tools.map(fill).join(', ')} and its guide.md. Work only inside ${dir}, and name every file by its full path there (${dir}/ui/register.tsx, not ui/register.tsx).`,
    `Goal: make it do this instead — ${description}`,
    AGENT_PARTNERSHIP,
    // A copy asked for a GitHub tracker stopped twice before the person had anything: once after a
    // question it could have answered itself (start empty or with every repository), once to wait
    // for a review before installing. The person waits on every stop; a working app comes first.
    'Deliver a working prototype in this one turn: do steps 1–7 without ending your turn before step 7. Build the smallest version that does what was asked end to end, on real data, and nothing beyond it; extras come after the person has the app. A choice with a sensible default is yours — make it and name it in your final message. Ask only what no default can answer, and after the answer carry on with the steps. A review is not a step: never hold the install for one.',
    [
      // Every tool call is a model round trip, and a mini app is a dozen files: reading them one
      // per step and building after each edit made creation take minutes longer than its work.
      'Work in this order; the layout below is complete, so do not list the tree. Batch: issue the reads of one step together in a single turn, write independent files together, and build once the whole domain is written — not after each file.',
      `1. READ the entries in one batch — same path and export, the body is yours: mini-app.json (description, category, config, commands; keep "backend" pointing at ./backend/index.ts), guide.md (what the agent needs to know to use the app), ui/register.tsx (labels, icon, agentContext, tool list, resource URI), ui/Workspace.tsx (export Workspace, the root the frame renders), backend/index.ts (tools, wiring, routes), backend/routes.ts. With them, the patterns your mini app needs, and only those:`,
      ...scaffold.patterns.map(
        (pattern) => `   - ${pattern.use}: ${pattern.file} (at "${pattern.anchor}")`,
      ),
      `2. REPLACE the domain, ${scaffold.domainName} itself — delete it in one command, or rename it after what it now holds and rewrite it: ${copyDomain(scaffold, name).join(', ')}. No file, directory or identifier of it may survive (${scaffold.domainTokens.slice(0, 3).join(', ')}, …). Keep the FRAME byte for byte — ${frameList(kit, scaffold).join(', ')} — it imports no domain module, and its helpers are yours:`,
      ...FRAME_HELPERS.map((helper) => `   - ${helper}`),
      `3. TEST the new behaviour with bun:test — its stored state, its routes and each acting tool — and rewrite guide.md for the new domain: which tool does what, and what to tell the person. README.md and AGENTS.md are already written; leave them.`,
      `4. CHECK with \`mini-app check ${dir}\`: it looks for ${scaffold.domainName} leftovers and the house style, builds the backend and the UI, type-checks against the SDK and kit declarations and runs the tests. Every problem is one line with its file:line:col, all of them in one report: fix them all, then check again. The editor's diagnostics read the same tsconfig.json, so a type error shown after an edit is real — fix it before checking.`,
      `5. INSTALL with \`mini-app install ${dir}\` when every check passes: it builds the package and puts it into the running Localix (starting it when it is installed and not running). If Localix is not on this computer, \`mini-app build ${dir}\` leaves the package in ${dir}/dist/package and \`mini-app get-localix\` installs Localix — say so instead of installing.`,
      `6. If the Browser tool is available (inside Localix), LOOK at it: url "${view}" opens its view in the workbench. take_screenshot to see it, and steps (click, type) to do each thing the person will do; read the result, not the code. Fix what does not look or work right, check and install again. Otherwise say that visual and interaction checks were not run.`,
      `7. TELL the person "${displayName}" is in Localix's workspace overflow menu, what it does now and the defaults you chose. The workbench replaced the UI in place: do not ask them to restart or reload anything. Then offer two or three next steps, most useful first — what the request implies but the prototype leaves out, a review before sharing it, store icon and screenshots — and build them when asked.`,
    ].join('\n'),
    [
      'Contracts — each one a copy has broken before:',
      "- A tool: ctx.defineTool({ name, label, activeVerb, description, inputSchema: ctx.z.object({ … }), executionMode: 'parallel' for a read or 'sequential' for a change, mutates, classify, permissionPaths: () => [], async execute(_toolCallId, input) { return { content } } }). classify for a tool whose input has an action enum: classifyByAction({ list: { effect: 'read' }, add: { effect: 'session' } }) from @localixai/mini-app-sdk/backend; for any other tool a constant, e.g. classify: () => ({ effect: 'read' }) — classifyByAction on an input with no action field answers external for every call, so a read-only session refuses even a read. Give the agent tools that ACT on the domain whenever a user would ask the agent to do it, not only ones that read it.",
      '- What the open tab adds to the person\'s message comes in two halves that must agree. toMessageBinding with resourceMessageBindingDraft({ uri }) in ui/register.tsx needs a backend resourceProvider (with contextProviders) that expands that uri — backend/context.ts is the pattern, so rewrite it rather than delete it; with no provider every message carries "no resource provider". Without a resource, drop toMessageBinding and publish the visible state instead (below).',
      "- The backend runs inside Localix's own process: a synchronous call freezes all of Localix while it runs. Run a command with Bun.spawn(…) and read it with await readProcessOutputWithTimeout(child, ms) from @localixai/mini-app-sdk/backend, never Bun.spawnSync, execSync or execFileSync; keep file reads async too. A command or network call that costs seconds runs when the person or the agent asks for it, not on a view's timer.",
      '- State the user creates lives in openJsonStore under ctx.dataDir (a string on the context register(ctx) receives), never only in memory. register(ctx) runs more than once: build what needs ctx inside it, keep the rest at module level.',
      LIVE_DATA_CONTRACT,
      '- Visibility gates polling and nothing else: anything that runs while the pane is hidden — a countdown, a job — is timestamps in the backend, where the tools reach it, and the view derives it with useNow().',
      '- Every action in the view goes through send(), and its route answers with the new state. Never keep a second copy of the state beside the snapshot.',
      "- A route that takes a body declares it: .post('/path', jsonBody(schema), (c) => … c.req.valid('json') …) with jsonBody from @localixai/mini-app-sdk/backend. Never parse the body yourself with the request's json(): it accepts a body of any type, so a page on any origin can post to it.",
      "- For the agent to act on something that happened in the view (the person moved, a watched value changed), the ROUTE calls ctx.host.wake({ userId: c.env.userId, sessionId: c.env.sessionId, message, tools: [the mini app's own tools that answer], key }); the view sends ?sessionId= from useWorkItemSessionId() (@localixai/mini-app-sdk/ui/work-item-session) — the chat the tab belongs to, not the one on screen — and registers its work item with scope: 'session'. ctx.host exists on the backend load only, so hand wake to the routes from register. It answers delivered, missed, refused or failed — decide what the view shows when nobody will answer. Never wake from your own tool: the agent would wake itself.",
      HOST_JUDGMENT_CONTRACT,
      "- State that belongs to ONE chat (a game, a draft for that conversation) lives under ctx.sessionStorage.resolveDataDir(userId, sessionId), which the host deletes with the chat; a route passes c.env.sessionId (absent unless the user owns it — refuse then), a tool the session.id of execute's fifth argument.",
      '- To tell the person something happened (a timer ran out), call toast from @localixai/mini-app-sdk/ui — toast.success(…) or toast.warning(…); a warning also raises a desktop notification.',
      "- Publish exactly what the user sees as message context and clear it when the surface is inactive: publishMessageContext({ strategy: 'replace', bindings: [snippetMessageBindingDraft({ label, content })] }) from @localixai/mini-app-sdk/ui, and publishMessageContext(null) — the host drops any other shape.",
    ].join('\n'),
    [
      `Look like Localix: build every control from the kit — never a raw <button>, <input>, <select> or <textarea>; the kit carries the focus ring, the control heights and the tokens. Colour with host tokens — text-text-soft, text-text-faint, border-border, bg-surface-hover, text-status-error|warning|success|info — never a palette class such as text-red-500; radius rounded-md or rounded-lg. No second theme, no pane-sized background, no file over 300 lines. Keep every contributed id prefixed "${name}:" and every tool name unique across mini apps.`,
      catalog,
      digest,
    ]
      .filter(Boolean)
      .join('\n'),
    // The catalog already names every kit id by its job; the bare list of ~100 ids repeated it
    // without the job, and only when there is no catalog is the list the agent's sole source.
    `Imports: the backend may use ${kit.manifest.authoring.backendSharedModules.join(', ')}, node:*, bun:* and its own files; the UI may use React, zod, lucide-react, @localixai/mini-app-sdk/ui* (not /ui/testing) and the host kit \`@localixai/kit/<id>\`${catalog ? ` — the ids ${KIT_CATALOG_FILE} lists` : ` — ids: ${kit.manifest.kitModules.join(', ')}`}. Nothing else resolves. Everything you need is in this folder and this message; do not search the disk for SDK or kit sources.`,
  ].join('\n\n')
}
