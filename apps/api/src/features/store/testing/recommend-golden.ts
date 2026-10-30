import type { Listing } from '@localixai/store'

import { makeListing } from './fake-provider'

/**
 * THE GOLDEN SET for recommendations (`docs/internals/store.md`, "Measuring recommendations"): a
 * catalog the size of a small marketplace, with the near misses a real one has (two database
 * tools, a font tool beside a slides tool); the cases are in `recommend-golden-cases.ts`. The ids
 * are what a person would call each package, and the summaries are written as marketplaces write
 * them: short, and not always about the words a file uses.
 */

type Entry = [id: string, category: string, publisher: string, summary: string, tags: string[]]

const ENTRIES: Entry[] = [
  [
    'docker-compose',
    'Development',
    'Acme',
    'Run, inspect and debug Docker Compose services',
    ['docker', 'containers'],
  ],
  [
    'container-logs',
    'Development',
    'Boxworks',
    'Tail and search logs of running containers',
    ['docker', 'logs'],
  ],
  [
    'kubernetes',
    'Development',
    'Acme',
    'Manage Kubernetes clusters, pods and deployments',
    ['k8s', 'helm'],
  ],
  [
    'terraform',
    'Development',
    'Infra Co',
    'Plan and apply Terraform infrastructure changes',
    ['iac', 'hcl'],
  ],
  [
    'aws-cli',
    'Development',
    'Infra Co',
    'Query and change AWS resources from the chat',
    ['aws', 'cloud'],
  ],
  [
    'github-actions',
    'Development',
    'Octo',
    'Read CI runs and fix failing workflows',
    ['ci', 'github'],
  ],
  [
    'postgres',
    'Database',
    'Acme',
    'Query PostgreSQL databases and explain slow queries',
    ['sql', 'postgres'],
  ],
  ['mysql', 'Database', 'Dolphin', 'Query MySQL and MariaDB databases', ['sql', 'mysql']],
  ['redis', 'Database', 'Cache Co', 'Inspect Redis keys, streams and memory', ['redis', 'cache']],
  [
    'mongodb',
    'Database',
    'Leaf',
    'Query MongoDB collections and aggregation pipelines',
    ['nosql', 'mongo'],
  ],
  ['prisma', 'Database', 'Prisma', 'Edit Prisma schemas and run migrations', ['orm', 'schema']],
  ['sql-formatter', 'Database', 'Tidy', 'Format and lint SQL files', ['sql', 'format']],
  [
    'react-components',
    'Frontend',
    'Pixel',
    'Scaffold and refactor React components and hooks',
    ['react', 'jsx'],
  ],
  [
    'tailwind',
    'Frontend',
    'Pixel',
    'Tailwind CSS class suggestions and design tokens',
    ['css', 'tailwind'],
  ],
  [
    'storybook',
    'Frontend',
    'Pixel',
    'Write stories and visual tests for UI components',
    ['ui', 'testing'],
  ],
  [
    'accessibility',
    'Frontend',
    'Open A11y',
    'Audit web pages for accessibility problems',
    ['a11y', 'wcag'],
  ],
  [
    'playwright',
    'Testing',
    'Browserco',
    'Write and run end-to-end browser tests',
    ['e2e', 'browser'],
  ],
  [
    'jest-helper',
    'Testing',
    'Unit Co',
    'Generate unit tests and fix failing assertions',
    ['tests', 'unit'],
  ],
  [
    'pandas',
    'Data',
    'Frame',
    'Explore and clean tabular data with pandas',
    ['python', 'dataframes'],
  ],
  ['notebooks', 'Data', 'Frame', 'Run Jupyter notebooks and plot results', ['jupyter', 'python']],
  ['charts', 'Data', 'Plotty', 'Turn numbers into charts', ['visualization']],
  [
    'slides',
    'Productivity',
    'Deckhand',
    'Make PowerPoint decks from an outline',
    ['pptx', 'presentations'],
  ],
  [
    'docs-writer',
    'Productivity',
    'Inkwell',
    'Draft Word documents and reports',
    ['docx', 'writing'],
  ],
  [
    'spreadsheets',
    'Productivity',
    'Gridco',
    'Build and fix Excel spreadsheets and formulas',
    ['xlsx', 'excel'],
  ],
  ['pdf-tools', 'Productivity', 'Inkwell', 'Fill, merge and extract text from PDF files', ['pdf']],
  ['fonts', 'Design', 'Typeface', 'Preview and pair typefaces', ['typography']],
  ['icons', 'Design', 'Glyph', 'Search icon sets and export SVGs', ['svg', 'icons']],
  ['color-palette', 'Design', 'Glyph', 'Generate accessible color palettes', ['color', 'design']],
  ['figma', 'Design', 'Frames', 'Read Figma files and turn frames into code', ['figma', 'design']],
  ['stripe', 'Business', 'Pay Co', 'Look up Stripe payments, customers and refunds', ['payments']],
  ['crm', 'Business', 'Sales Co', 'Search contacts and deals in your CRM', ['sales']],
  ['calendar', 'Productivity', 'Timely', 'Schedule meetings and find free time', ['calendar']],
  [
    'rust-analyzer',
    'Development',
    'Ferris',
    'Rust language intelligence: errors, types and fixes',
    ['rust', 'cargo'],
  ],
  [
    'python-lsp',
    'Development',
    'Snake',
    'Python language intelligence and type checking',
    ['python', 'types'],
  ],
  [
    'go-tools',
    'Development',
    'Gopher',
    'Go formatting, tests and module upgrades',
    ['go', 'golang'],
  ],
  [
    'security-scan',
    'Security',
    'Shield',
    'Find vulnerable dependencies and leaked secrets',
    ['audit', 'secrets'],
  ],
  [
    'sentry',
    'Development',
    'Watch Co',
    'Read Sentry errors and the stack traces behind them',
    ['errors', 'monitoring'],
  ],
  ['music', 'Fun', 'Tunes', 'Play focus music while you work', ['audio']],
  ['weather', 'Fun', 'Sky', 'The forecast where you are', ['weather']],
]

/** What a package says it is for, as an editorial marketplace would (`recommend-rules.ts`). */
const SUGGEST_FOR: Record<string, Listing['suggestFor']> = {
  terraform: { files: ['*.tf', '*.tfvars'] },
  prisma: { files: ['schema.prisma'], dependencies: ['prisma', '@prisma/client'] },
  sentry: { dependencies: ['@sentry/node', '@sentry/react'] },
}

export const CATALOG: Listing[] = ENTRIES.map(([id, category, publisher, summary, tags]) =>
  makeListing({
    id,
    kind: 'plugin',
    displayName: id,
    summary,
    category,
    tags,
    publisher: { name: publisher, verified: true },
    source: { id: 'golden', label: 'Golden', trust: 'official' },
    ...(SUGGEST_FOR[id] ? { suggestFor: SUGGEST_FOR[id] } : {}),
  }),
)
