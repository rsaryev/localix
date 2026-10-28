/**
 * The contract a new mini app is written against, said once and printed by `mini-app create`, so
 * the agent has it whether or not a skill was loaded (Localix runs a skill's shell injections only
 * for an explicit slash command). Every line names an SDK export that exists: the copy is
 * type-checked against the same declarations, and a name here that drifted would cost a check.
 *
 * Why so much is said up front: a generated meal tracker spent most of its 2m17s reading the
 * template's plumbing, steering subagents it had started before any code existed and reworking a
 * screen it had not designed. The plumbing is now the SDK's (`createMiniApp`, collections,
 * `useCollection`, `screenUi`), so the agent's whole job is the domain and the screen, and this is
 * everything it needs for both.
 */

/** The mini app API that first has the app layer this contract names. */
export const APP_LAYER_API_VERSION = 2

/**
 * What a mini app is FOR, said before how to build one. Told only the template's mechanics, a copy
 * asked for "calories from a photo" stopped to report that the kit has no image upload or vision
 * API — while the agent reading that could see the photo itself.
 */
export const AGENT_PARTNERSHIP =
  'How a Localix mini app works: it is never used alone. Beside it is the chat with the agent — you — which reads the photos, screenshots, PDFs and files the person attaches, understands free text in any language, knows the world and calls every enabled mini app\'s tools. So the MINI APP keeps the state, shows it and gives the agent tools to read and change it; the AGENT does the understanding. Build no upload, model, vision, OCR or LLM call, text parser or API key into the mini app. Design each tool for the agent to fill with structured input it extracts (a meal photo becomes log_meal({ items: [{ name, grams, kcal, protein, fat, carbs }] })); the app validates, stores and sums. The screen\'s empty state tells the person what to do in chat ("attach a photo of your meal and ask to log it"). Never stop to ask how the app should reach a model or an image: you are that model.'

/** The app layer: what a copy is made of, by file, and the SDK calls each file makes. */
export const APP_LAYER = [
  'The app layer — every name below is exported by the SDK the check types against:',
  '- shared/model.ts — the contract both sides import: zod schemas of an item and of its input, and the pure logic (totals, grouping, what the agent is told). Write it FIRST; everything else follows from it.',
  "- backend/<items>.ts — defineCollection({ name: 'meals' (lower-kebab), item: mealSchema, input: mealInputSchema (a z.object), create: (input, { id, now }) => ({ ...input, id, at: new Date(input.at ?? now).toISOString() }) (kept in UTC; sort by Date.parse, never as text), scope: 'app' | 'chat', limit, search: (meal) => `${meal.name} ${meal.note}` }) from @localixai/mini-app-sdk/backend. 'app' keeps it across chats under ctx.dataDir; 'chat' gives each chat its own, deleted with the chat. search makes it findable by meaning.",
  '- backend/index.ts — export function register(ctx) { const app = createMiniApp(ctx); const meals = app.collection(mealsSpec); return app.registration({ tools: createTools(ctx, meals), routes }) }. That mounts GET/POST /rpc/<app>/<collection>, PATCH and DELETE /<collection>/:id (each answering { items }), the feed that updates an open screen the moment a tool writes, and the semantic index. routes is an optional new Hono<MiniAppRouteContext>() for anything else (a settings read, an action); a route that takes a body uses jsonBody(schema). register(ctx) runs more than once: keep state in collections, never in a module variable.',
  "- A collection in code: await meals.list(where?), get(id, where?), add(input, where?) → the item, update(id, patch, where?) → item | null, remove(id, where?) → boolean, search(text, { limit }) → items nearest in meaning. where is { sessionId } for a 'chat' collection: a tool passes the session.id of execute's fifth argument.",
  "- backend/tools.ts — ctx.defineTool({ name: '<snake>_<verb>', label, activeVerb, description, inputSchema: the shared input schema with a .describe() per field — mealInputSchema.extend({ name: mealInputSchema.shape.name.describe('…') }), never a looser copy, so the agent is shown the limits the collection keeps — executionMode: 'sequential' for a write or 'parallel' for a read, mutates, classify: () => ({ effect: 'host' }) for a write or ({ effect: 'read' }), permissionPaths: () => [], async execute(_toolCallId, input) { return { content: text } } }). Answer with what changed AND where things stand (today's total, what is left), so the agent can tell the person in one line; return { content, isError: true } only when the input was wrong and nothing happened. Give the agent a tool for everything the person can do on the screen.",
  '- Settings the person changes: "config" in mini-app.json ({ "DAILY_GOAL": { "type": "string", "title", "description", "default": "2000" } }); the backend reads ctx.config.DAILY_GOAL, parsed with a fallback, and the screen reads it through a small route.',
  "- ui/App.tsx — export function App({ active, publishMessageContext }: ScreenProps). const meals = useCollection<Meal, MealInput>({ app: APP, name: 'meals', item: mealSchema, active }) from @localixai/mini-app-sdk/ui/app gives { items, loading, error, sending, add(input), update(id, patch), remove(id) }; each change resolves to the new list or null (error says why). Another route: usePolledSnapshot({ path: `/rpc/${APP}/settings`, schema, intervalMs: null, active }) from @localixai/mini-app-sdk/ui/route-snapshot. Anything derived from time: useNow(60_000, active) from @localixai/mini-app-sdk/ui/now. Compute what the screen shows with the SAME shared function the tools use.",
  '- Tell the agent what the screen shows: useAgentContext(publishMessageContext, active && !loading, { label, content }) with the text the shared logic makes; it is cleared when the tab hides. A failed read: const problem = useScreenProblem({ app, subject, failure: meals.error, showingData }) and {problem && <ProblemLine {...problem} />} (ProblemLine from @localixai/mini-app-sdk/ui/components).',
  "- ui/register.tsx — export const registerUi = screenUi({ app: APP, title, label, keywords, Icon (lucide-react), Screen: lazy App, loading: <LoadingHint>…</LoadingHint>, agentContext: { description, tools: [the tool names], nextSteps: [when to call which] }, scope? }). scope: 'chat' gives every chat its own tab, for a 'chat' collection.",
  "- Tests (bun:test) through what the agent and the screen do, from @localixai/mini-app-sdk/backend/testing: await using ctx = await testMiniAppContext({ name: APP, config? }); const registration = register(ctx); await callTool(registration, '<tool>', input) → { text, isError }; await requestRoute(registration, 'GET', '/meals') → { status, json }. Test the shared logic directly. A mini app's own tests cannot render the screen: keep its logic in shared functions and test those.",
].join('\n')

/** What goes beyond one collection and a screen: each a call the SDK already makes safe. */
export const BEYOND_COLLECTIONS = [
  'When the app needs more (backend only; each answers when the host cannot, so keep a fallback):',
  "- A small, frequent judgment the app makes itself (which column, which of a few options): await decide(ctx, { userId, sessionId, purpose: 'triage', state: { …facts }, question, options: { todo: 'Not started', done: 'Finished' }, fallback: 'todo' }) → { pick, by: 'model' | 'fallback' } from @localixai/mini-app-sdk/backend. It bills the person's chat; never call a model of your own.",
  "- Order items by meaning: await rankByMeaning(ctx, query, items, (item) => text) → { items, by: 'model' | 'fallback' }, on this computer's embedding model, free. A collection's own search(text) already does this for its items.",
  "- Hand something to the agent from a route (a button that needs judgment, a watched value changed): await askAgent(ctx, { userId: c.env.userId, sessionId: c.env.sessionId, message, tools: [your tools], key }) → { status: 'delivered' | 'missed' | 'refused' | 'failed' }; the screen sends ?sessionId= from useWorkItemSessionId() and registers with scope: 'chat'. Never from your own tool: the agent would wake itself.",
  '- Live data that is not a collection: a wsFrames entry in app.registration({ backend: { wsFrames } }), followed with createRealtimeFeed/useRealtimeFeed from @localixai/mini-app-sdk/ui/realtime-feed; files with ctx.watchPath, never node:fs.watch. A command: Bun.spawn and readProcessOutputWithTimeout, never a synchronous call — the backend runs inside Localix and a sync call freezes it.',
  '- A notice to the person: toast.success(…) or toast.warning(…) from @localixai/mini-app-sdk/ui.',
].join('\n')

/**
 * How a finished screen looks. Told only "use the kit", copies came out as a form above a raw list:
 * correct, and nothing a person would show anyone. The template's screen is the bar. The rules
 * echo Impeccable's craft floor (github.com/pbakaus/impeccable), cut to what a data screen in a
 * narrow pane needs; the ones a machine can see are also checked (`check/design.ts`).
 */
export const DESIGN_BRIEF = [
  "Design — a polished product screen, not a form. Decide it before writing, the way the template's ui/App.tsx and ui/parts/ do. The squint test: blurred, the eye still finds the one number that matters, then its breakdown, then the items.",
  "- One headline: that number (today's kcal, this month's spend) at text-3xl font-semibold tabular-nums in the screen's own font (monospace is not a style for numbers), its goal and unit beside it in text-xs text-text-faint, inside a ContextRing (@localixai/kit/context-ring, fraction 0–1) or above a ProgressBar toward the goal. Then its history: TrendChart from @localixai/mini-app-sdk/ui/stats-charts, the last 7 or 30 days. Never a row of identical stat tiles.",
  '- Group by space and dividers, not boxes: at most one container level (a rounded-lg border list with divide-y divide-border-faint), never a card in a card. Tight inside a group (gap-1 to gap-2), generous between groups (gap-6).',
  '- A row: the title text-sm font-medium, a meta line (time · category) text-xs text-text-faint, the value right-aligned tabular-nums with its unit muted, an IconButton to remove; text in a flex row gets min-w-0 and truncate.',
  '- Colour is meaning, never decoration: host tokens only; text-status-success on track, -warning near a limit, -error over it, always beside words or a number. No gradients, glow, glass, thick side stripes or emoji (icons are lucide-react).',
  '- Words: a button says verb and object ("Log meal", never "Submit"); one name per thing across the screen, the tools and guide.md; an error says what failed and what to do.',
  '- Layout: an @container root that scrolls on one axis (h-full min-h-0 overflow-y-auto) and fills its pane — no centred max-w column — with px-4 py-5. It may be 360px wide: one column until @lg, then columns side by side; reflow, never shrink the text.',
  '- States: LoadingHint while loading, controls disabled while a change is sending, StateNotice with an icon when empty, saying what to do in the chat. Never sample or placeholder data: every number comes from the shared logic over real items.',
  '- An icon of its own: `mini-app icon <folder> --glyph \'<path d="…"/>\'` draws the glyph (24×24, stroke, lucide style — the same icon as Icon in ui/register.tsx) on the store tile into icon.svg.',
].join('\n')
