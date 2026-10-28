# Recipes

Each recipe is the whole of one pattern, in the calls the SDK already makes safe. The template (the
folder `mini-app create` copies) shows the first three working; the rest are the shapes to follow.

## Log what the person shows in the chat

The agent reads the photo or the message; the tool takes what it extracted. Describe the shared
schema's fields (never retype them looser) so the agent knows what to fill, and answer with where
things stand.

```ts
// shared/model.ts
export const mealInputSchema = z.object({
  name: z.string().min(1),
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative().default(0),
  at: z.iso.datetime({ offset: true }).optional(),
})
export const mealSchema = mealInputSchema.extend({ id: z.string(), at: z.string() })

// backend/meals.ts
export const mealsSpec = defineCollection({
  name: 'meals',
  item: mealSchema,
  input: mealInputSchema,
  create: (input, { id, now }) => ({ ...input, id, at: new Date(input.at ?? now).toISOString() }),
  search: (meal) => meal.name,
})

// backend/tools.ts — one call per dish the agent saw
ctx.defineTool({
  name: 'meal_log_add',
  label: 'Log a meal',
  activeVerb: 'Logging',
  description:
    'Log one dish: its name and estimated kcal and protein. Answers with today’s totals.',
  // The shared schema, described: the agent sees the limits the collection keeps.
  inputSchema: mealInputSchema.extend({
    name: mealInputSchema.shape.name.describe('The dish, as the person would name it.'),
    kcal: mealInputSchema.shape.kcal.describe('Estimated kcal for the portion shown.'),
  }),
  executionMode: 'sequential',
  mutates: true,
  classify: () => ({ effect: 'host' }),
  permissionPaths: () => [],
  async execute(_toolCallId, input) {
    const meal = await meals.add(input)
    return { content: `Logged ${meal.name}: ${meal.kcal} kcal.\n${describe(await meals.list())}` }
  },
})
```

## A setting the person changes

Declare it under `config` in `mini-app.json`, read it with a fallback, serve it to the screen from a
route. A changed setting re-wires the backend, so `register(ctx)` sees the new value.

```ts
const goal = Number(ctx.config.DAILY_GOAL ?? 2000) || 2000
const routes = new Hono<MiniAppRouteContext>().get('/settings', (c) => c.json({ goal }))
return app.registration({ tools, routes })
```

The screen: `usePolledSnapshot({ path: `/rpc/${APP}/settings`, schema, intervalMs: null, active })`
from `@localixai/mini-app-sdk/ui/route-snapshot`.

## Test it as the agent and the screen use it

```ts
import {
  callTool,
  fakeSemantic,
  requestRoute,
  testMiniAppContext,
} from '@localixai/mini-app-sdk/backend/testing'

test('a logged meal is on the screen', async () => {
  await using ctx = await testMiniAppContext({ name: 'meal-log', config: { DAILY_GOAL: '1800' } })
  const app = register(ctx)
  expect((await callTool(app, 'meal_log_add', { name: 'Soup', kcal: 180 })).text).toContain('180')
  expect((await requestRoute(app, 'GET', '/meals')).json).toEqual({
    items: [expect.objectContaining({ name: 'Soup' })],
  })
})
```

`fakeSemantic()` passed as `host: { semantic }` makes `search` match by words once `ready` is set,
so a search tool is tested both before and after the model is ready.

## One state per chat

A game, a draft for one conversation: `scope: 'chat'` on the collection, `scope: 'chat'` on
`screenUi` (every chat gets its own tab), and `useCollection({ …, scope: 'chat' })`. A tool passes
the chat: `meals.add(input, { sessionId: context.session.id })` with `context` the fifth argument of
`execute`. The host deletes a chat's state with the chat. Opened outside a chat, its routes answer
400 "Open this in a chat."

## A button that needs the agent

The route hands the moment to the agent; the screen sends the chat it belongs to.

```ts
routes.post('/ask', jsonBody(z.object({ question: z.string() })), async (c) => {
  const sessionId = c.env.sessionId
  if (!sessionId) return c.json({ error: 'Open this in a chat.' }, 400)
  const answer = await askAgent(ctx, {
    userId: c.env.userId,
    sessionId,
    message: `The person asked from the screen: ${c.req.valid('json').question}`,
    tools: ['meal_log_add'],
    key: 'ask',
  })
  return c.json(answer)
})
```

The screen gets the chat from `useWorkItemSessionId()`
(`@localixai/mini-app-sdk/ui/work-item-session`) and adds `?sessionId=` to the request;
`screenUi({ scope: 'chat' })`. Show what happens when the answer is `missed`. Never call `askAgent`
from your own tool: the agent would wake itself.

## A small choice the app makes itself

```ts
const { pick, by } = await decide(ctx, {
  userId,
  sessionId,
  purpose: 'triage',
  state: { title: card.title, due: card.due, overdue },
  question: 'Which column does this card belong in?',
  options: { todo: 'Not started', doing: 'Being worked on', done: 'Finished' },
  fallback: 'todo',
})
```

`by: 'fallback'` (with a `reason`) when no decision model answered or it was unsure: the app goes on
with the fallback. Facts code can compute go in `state`; the model weighs them.

## Order by meaning

`rankByMeaning(ctx, query, items, (item) => item.title)` — nearest first on this computer's
embedding model, or the given order with `by: 'fallback'` while it is not ready. A collection's own
`search(text)` does this for its items, with the index kept current by the collection.
