import type { FeatureRow } from './homeContentTypes'

/**
 * The second half of the homepage's claims: the platform that builds the rest, the design that holds
 * it together, the work that runs while you are away, the controls, and the task board. The first
 * half (agents, context, the shared board, the browser) is `homeContent.ts`. The same rules apply
 * to both: every statement stays inside what its owning guide documents, and none states a speed,
 * a duration, or a team size.
 */
export const PLUGIN_FEATURES: FeatureRow[] = [
  {
    kicker: 'For example',
    title: 'Photograph a meal, and the agent logs it',
    body: 'Send a photo in the chat. With a model that accepts images, the agent reads it and calls the tracker’s own tools, and the plugin shows the log and totals.',
    slug: 'extending--build-with-the-agent',
    anchor: 'how-it-works',
  },
  {
    kicker: 'Built together',
    title: 'Interface and tools in one pass',
    body: 'The agent writes the native interface from the app’s own components and the tools that go with it, tests them, and checks the result in the browser. A build that fails never replaces the one that works.',
    slug: 'extending--build-with-the-agent',
    anchor: 'how-it-works',
  },
  {
    kicker: 'Same contract',
    title: 'The product’s own workbenches are plugins',
    body: 'The Kanban board, DevOps, Project Space, Code Graph, Database, and Git are plugins on the contract you get, and the larger ones run to tens of thousands of lines.',
    slug: 'extending--plugins',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Plugins that answer back',
    title: 'Play against the agent',
    body: 'A plugin action can start an agent turn. That is how Chess, Checkers, Battleship, Tic-tac-toe, and 2048 work: your move wakes the agent, and its reply lands on the same board.',
    slug: 'features--game-2048',
    anchor: 'when-the-agent-plays',
  },
]

export const CRAFT_FEATURES: FeatureRow[] = [
  {
    kicker: 'One kit',
    title: 'The app and its plugins draw from one design system',
    body: 'More than eighty kit modules serve the workspace and every plugin. A style check rejects hand-rolled controls and raw colors in a generated one, so it looks like the ones that ship.',
    slug: 'extending--ui-kit',
    anchor: 'the-kit-owns-the-design-system',
  },
  {
    kicker: 'Guarded',
    title: 'Tests keep the interface from drifting',
    body: 'Repository tests fail on raw pixel heights, hard-coded colors, and literal durations across the app, the kit, and every plugin, so the interface holds together as it grows.',
    slug: 'extending--ui-kit',
    anchor: 'one-package-two-consumers',
  },
  {
    kicker: 'Themes and preferences',
    title: 'Dark, light, and what your system asks for',
    body: 'Dark and light themes, a glass material on macOS, and handling for reduced motion, reduced transparency, and forced colors.',
    slug: 'features--workspace',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Keyboard first',
    title: 'Reach anything without the mouse',
    body: 'A command palette, global search, and rebindable shortcuts, with split tabs and persistent terminals in one window.',
    slug: 'features--workspace',
    anchor: 'groups-and-placement',
  },
]

export const AUTONOMY_FEATURES: FeatureRow[] = [
  {
    kicker: 'Loops',
    title: 'Run a prompt on a schedule, or at the agent’s pace',
    body: 'Fixed loops use a cron schedule. Dynamic loops let the agent pace itself between one minute and one hour. Both survive a restart with one catch-up run.',
    slug: 'features--loops',
    anchor: 'after-a-restart',
  },
  {
    kicker: 'Monitors',
    title: 'Ask the agent to watch, and wake it when it matters',
    body: 'A monitor polls a command and wakes the agent when it passes. A polled wait resumes after a restart, and secrets reach the command through the environment, not the model.',
    slug: 'features--monitors',
    anchor: 'across-a-restart',
  },
  {
    kicker: 'Plans',
    title: 'Review a plan before anything runs',
    body: 'Plan mode is read-only except the plan file. Versions carry inline comments and diffs, and approval picks the mode and, with several agents, who starts.',
    slug: 'features--permission-modes',
    anchor: 'review-and-approve-a-plan',
  },
  {
    kicker: 'Resume',
    title: 'Pick up where a run stopped',
    body: 'A durable queue holds wakes while you type, and your message always goes first. Continue offers approved work that was stopped midway.',
    slug: 'features--permission-modes',
    anchor: 'continue-a-plan-that-stopped',
  },
]

export const CONTROL_FEATURES: FeatureRow[] = [
  {
    kicker: 'Workload routing',
    title: 'Route each workload to its own model',
    body: 'Choose the provider, model, and supported reasoning level for the conversation, then give session titles, inline completion, and delegated agents their own routes. Each unset route uses its documented fallback.',
    slug: 'features--providers',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Capabilities',
    title: 'Set the tool surface before the run starts',
    body: 'One ordered rule list per agent decides what its runs may use, and the last matching rule wins. Plugin tools, the Kanban board’s included, are ruled like built-in ones, so what a role can do is a list you can read rather than a mode you have to remember.',
    slug: 'features--capabilities',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Declarative permissions',
    title: 'Decide tool calls with ordered rules',
    body: 'Rules match a tool name, mutation class, path, or command and resolve to allow, ask, or deny. The last matching rule wins, so a narrow allow can follow a broad deny. Shipped roles ask before outside-workspace access and dangerous shell commands.',
    slug: 'features--permissions',
    anchor: 'permission-contract',
  },
  {
    kicker: 'Credentials',
    title: 'Keep keys out of the transcript',
    body: 'API keys and OAuth tokens live in an encrypted credential vault. Environment-backed credentials stay on the server, and connection responses carry only a masked suffix.',
    slug: 'features--providers',
    anchor: 'how-it-works',
  },
]

export const KANBAN_FEATURES: FeatureRow[] = [
  {
    kicker: 'Shared control',
    title: 'Manage the board together',
    body: 'Every chat has its own board, kept by you and the agent in that chat. Create, edit, prioritize, drag, and organize tasks from the board or the conversation.',
    slug: 'features--task-board',
    anchor: 'what-you-can-do',
  },
  {
    kicker: 'Agent planning',
    title: 'Let the agent build the plan',
    body: 'Give the agent a goal and it can create an epic, break it into tasks, connect dependencies, assign owners, and keep the plan with the chat.',
    slug: 'features--task-board',
    anchor: 'how-the-agent-works-with-it',
  },
  {
    kicker: 'Execution',
    title: 'Choose when to delegate',
    body: 'An agent takes a task explicitly, or delegates it to a child agent with a self-contained brief. The board never starts work, and a task waits on its dependencies.',
    slug: 'features--task-board',
    anchor: 'statuses',
  },
  {
    kicker: 'Linked context',
    title: 'Point the agent at a card',
    body: 'Link a card into a message or drag it into the composer, turn a batch of review comments into a backlog card, and find the chat’s cards in global search.',
    slug: 'features--task-board',
    anchor: 'what-you-can-do',
  },
]
