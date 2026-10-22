import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { slugifyDocHeading } from '../lib/docHeading'
import {
  AUTONOMY_FEATURES,
  BROWSER_FEATURES,
  CONTEXT_FEATURES,
  EXTERNAL_FEATURES,
  CONTROL_FEATURES,
  CONVERSATION_FEATURES,
  CRAFT_FEATURES,
  KANBAN_FEATURES,
  PLUGIN_FEATURES,
  PLUGINS,
  SECTION_GUIDES,
  SPACE_FEATURES,
} from './homeContent'
import { DEMO_POSTER, DEMO_SRC } from '../components/home/DemoFilm'
import { WORKSPACE_LINKS, PLATFORM_OVERVIEW } from './homeOverview'

interface NavigationGroup {
  pages?: string[]
  categories?: NavigationGroup[]
}

const CAPABILITIES = [
  ...CONVERSATION_FEATURES,
  ...CONTEXT_FEATURES,
  ...EXTERNAL_FEATURES,
  ...SPACE_FEATURES,
  ...BROWSER_FEATURES,
  ...PLUGIN_FEATURES,
  ...CRAFT_FEATURES,
  ...AUTONOMY_FEATURES,
  ...CONTROL_FEATURES,
  ...KANBAN_FEATURES,
  ...PLUGINS,
]

test('homepage capabilities describe reachable product behavior', () => {
  const marketingCopy = [...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW]
    .flatMap(({ title, body }) => [title, body])
    .join(' ')

  expect(marketingCopy).not.toMatch(/\b(?:groundwork|not yet wired|not wired)\b/i)
})

test('homepage copy stays in the calm register the README uses', () => {
  // The product register is factual and hedged. Vocabulary that promises rather
  // than describes has no doc to check it against, so it is banned outright —
  // including in the section ledes, which live in the page itself.
  const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')
  const copy = [
    ...[...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW].flatMap(({ title, body }) => [
      title,
      body,
    ]),
    homePage,
  ].join(' ')

  expect(copy).not.toMatch(
    /\b(?:revolutionary|seamless|seamlessly|blazing|powerful|game-changing|effortless|effortlessly|supercharge|unlock|unleash|cutting-edge|world-class)\b/i,
  )
})

test('homepage copy states no speed or duration the repository does not measure', () => {
  // The repository holds no benchmark for how fast the agent browser is or how long a generated
  // plugin takes, so a copy line that says so has nothing behind it.
  const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')
  const copy = [
    ...[...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW].flatMap(({ title, body }) => [
      title,
      body,
    ]),
    homePage,
  ].join(' ')

  expect(copy).not.toMatch(
    /\b(?:in seconds|within seconds|instantly|instant|in minutes|faster|fastest|lightning|real[- ]time)\b/i,
  )
})

test('the homepage is the hero and the demo', () => {
  const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')
  const rendered = [...homePage.matchAll(/<Section\s+id="([a-z-]+)"/gu)].map((match) => match[1])

  expect(rendered).toEqual(['intro'])
  expect(homePage).toContain('<DemoFilm />')
  expect(homePage).not.toContain('PlatformBento')
  expect(homePage).not.toContain('SectionNav')
})

test('the demo film is published with its poster', () => {
  // A missing file plays nothing and leaves an empty frame on the page.
  const films = readdirSync(new URL('../../public/films/', import.meta.url))

  expect(films).toContain(DEMO_SRC.replace('/films/', ''))
  expect(films).toContain(DEMO_POSTER.replace('/films/', ''))
})

test('the hero sizes its bird through the responsive layout', () => {
  const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')

  expect(homePage).toContain('hero-bird-slot')
  expect(homePage).toContain('hero-layout')
  expect(homePage).not.toContain('lg:-ml-28')
  const bird = readFileSync(new URL('../components/home/HeroBird.tsx', import.meta.url), 'utf8')
  expect(bird).toContain('stageClassName="h-full w-full"')
  expect(bird).not.toContain('calc(100%+')
})

test('every homepage capability links to a published documentation page', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../docs/public-nav.json', import.meta.url), 'utf8'),
  ) as { sections: NavigationGroup[] }
  const publicPaths = manifest.sections.flatMap((section) => [
    ...(section.pages ?? []),
    ...(section.categories ?? []).flatMap((category) => category.pages ?? []),
  ])
  const publishedSlugs = new Set(
    publicPaths.map((path) => path.replace(/\.md$/u, '').replaceAll('/', '--')),
  )
  const capabilityLinks = [...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW]
  const sectionLinks = Object.values(SECTION_GUIDES)

  for (const link of [...sectionLinks, ...capabilityLinks]) {
    expect(publishedSlugs.has(link.slug)).toBe(true)
  }

  const pathsBySlug = new Map(
    publicPaths.map((path) => [path.replace(/\.md$/u, '').replaceAll('/', '--'), path]),
  )
  for (const link of capabilityLinks) {
    const sourcePath = pathsBySlug.get(link.slug)
    expect(sourcePath).toBeTruthy()
    const source = readFileSync(new URL(`../../../../docs/${sourcePath}`, import.meta.url), 'utf8')
    const headingIds = new Set(
      [...source.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) => slugifyDocHeading(match[1])),
    )
    expect(headingIds.has(link.anchor)).toBe(true)
  }
})

test('homepage claims stay assigned to their owning guides', () => {
  const ownership = Object.fromEntries(CAPABILITIES.map((item) => [item.title, item.slug]))

  expect(ownership).toEqual({
    'One conversation, as many agents as the work needs': 'features--conversations',
    'Let the agent bring in a colleague': 'features--conversations',
    'Give each agent its own role, rules, and model': 'features--capabilities',
    'See who is answering, and stop it': 'features--conversations',
    'Know what the next message carries': 'features--workspace',
    'Open, search, link, and return': 'features--workspace',
    'Turn command output into a working surface': 'features--workspace',
    'Keep a long session inside the request budget': 'features--context-checkpoints',
    'Read a page as a tree, not a screenshot': 'features--visual-feedback',
    'Act in batches that settle once': 'features--visual-feedback',
    'Verify before it says done': 'features--visual-feedback',
    'Point at the result instead of describing it': 'features--visual-feedback',
    'The agent works the board the way you do': 'features--project-space',
    'References, not copies': 'features--project-space',
    'Keep an answer where you can see it': 'features--project-space',
    'A board your repository can hold': 'features--project-space',
    'Photograph a meal, and the agent logs it': 'extending--build-with-the-agent',
    'Interface and tools in one pass': 'extending--build-with-the-agent',
    'A mini app uses the models Localix already has': 'extending--plugin-semantics',
    'The product’s own workbenches are mini apps': 'extending--plugins',
    'Claude Code plugins work as they are': 'extending--claude-code-plugins',
    'Play against the agent': 'features--game-2048',
    'The app and its plugins draw from one design system': 'extending--ui-kit',
    'Keep projects in native workspace tabs': 'features--native-workspace-tabs',
    'Tests keep the interface from drifting': 'extending--ui-kit',
    'Dark, light, and what your system asks for': 'features--workspace',
    'Reach anything without the mouse': 'features--workspace',
    'Run a prompt on a schedule, or at the agent’s pace': 'features--loops',
    'Ask the agent to watch, and wake it when it matters': 'features--monitors',
    'Review a plan before anything runs': 'features--permission-modes',
    'Pick up where a run stopped': 'features--permission-modes',
    'Route each workload to its own model': 'features--providers',
    'Set the tool surface before the run starts': 'features--capabilities',
    'Decide tool calls with ordered rules': 'features--permissions',
    'Keep keys out of the transcript': 'features--providers',
    'Manage the board together': 'features--task-board',
    'Let the agent build the plan': 'features--task-board',
    'Choose when to delegate': 'features--task-board',
    'Point the agent at a card': 'features--task-board',
    // Bundled plugins that add a workbench, the five board games sharing one card. Code Review,
    // Deliverables and Webhook Notifier declare no workbench and are listed in the plugin guide.
    Database: 'features--database',
    DevOps: 'features--devops',
    Git: 'features--source-control',
    'Code Graph': 'features--code-graph',
    Reader: 'features--reader',
    Trading: 'features--trading',
    'Learning Studio': 'features--learning-loop',
    Documents: 'features--documents',
    Resumes: 'features--resumes',
    'API Client': 'features--api',
    'Your CLI history beside Localix chats': 'features--external-agents',
    'Read or continue the native session': 'features--external-agents',
    'Link a conversation instead of pasting it': 'features--external-agents',
    'See external activity in the same statistics view': 'features--external-agents',
    Games: 'features--game-2048',
  })
})
