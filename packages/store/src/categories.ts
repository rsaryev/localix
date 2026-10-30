/**
 * THE STORE'S CATEGORIES (`docs/internals/store-scale.md`, "Categories"): one fixed list, so a
 * shelf's category tabs mean the same thing whichever source a listing came from. A source's own
 * category maps through one table; a listing without one, or with one the table does not know, is
 * placed by the words of its tags, name and summary; when nothing matches it is Other. Never
 * guessed by a model.
 */
export const STORE_CATEGORIES = [
  'Development',
  'Data',
  'Content',
  'Productivity',
  'Design',
  'Security',
  'Operations',
  'Learning',
  'Games',
  'Utilities',
  'Other',
] as const
export type StoreCategory = (typeof STORE_CATEGORIES)[number]

/** A source's category, lowercased, to the Store's: mini app and plugin marketplaces alike. */
const CATEGORY_MAP: Record<string, StoreCategory> = {
  development: 'Development',
  'developer tools': 'Development',
  'developer-tools': 'Development',
  coding: 'Development',
  testing: 'Development',
  migration: 'Development',
  database: 'Data',
  data: 'Data',
  analytics: 'Data',
  finance: 'Data',
  math: 'Data',
  content: 'Content',
  writing: 'Content',
  media: 'Content',
  documentation: 'Content',
  productivity: 'Productivity',
  automation: 'Productivity',
  workflow: 'Productivity',
  design: 'Design',
  security: 'Security',
  deployment: 'Operations',
  monitoring: 'Operations',
  infrastructure: 'Operations',
  devops: 'Operations',
  operations: 'Operations',
  learning: 'Learning',
  education: 'Learning',
  games: 'Games',
  game: 'Games',
  entertainment: 'Games',
  utilities: 'Utilities',
  utility: 'Utilities',
  tools: 'Utilities',
}

/**
 * The words that place an uncategorized listing, most specific category first: the first
 * category with the most matching words wins.
 */
const KEYWORDS: ReadonlyArray<[StoreCategory, readonly string[]]> = [
  [
    'Security',
    ['security', 'vulnerability', 'vuln', 'secrets', 'auth', 'oauth', 'pentest', 'audit', 'cve'],
  ],
  [
    'Operations',
    [
      'kubernetes',
      'k8s',
      'docker',
      'deploy',
      'deployment',
      'terraform',
      'aws',
      'gcp',
      'azure',
      'cloud',
      'monitoring',
      'observability',
      'logs',
      'incident',
      'devops',
      'infrastructure',
      'helm',
      'ci',
    ],
  ],
  [
    'Data',
    [
      'database',
      'sql',
      'postgres',
      'postgresql',
      'mysql',
      'sqlite',
      'mongodb',
      'redis',
      'data',
      'analytics',
      'bigquery',
      'snowflake',
      'csv',
      'spreadsheet',
      'etl',
      'chart',
    ],
  ],
  ['Design', ['design', 'figma', 'ui', 'ux', 'css', 'tailwind', 'icons', 'illustration', 'mockup']],
  [
    'Content',
    ['writing', 'blog', 'docs', 'documentation', 'markdown', 'video', 'image', 'content', 'seo'],
  ],
  ['Learning', ['learn', 'learning', 'tutorial', 'course', 'teach', 'explain', 'education']],
  ['Games', ['game', 'games', 'arcade', 'puzzle', 'play']],
  [
    'Productivity',
    ['productivity', 'notes', 'calendar', 'email', 'tasks', 'todo', 'slack', 'notion', 'jira'],
  ],
  [
    'Development',
    [
      'code',
      'coding',
      'developer',
      'review',
      'refactor',
      'test',
      'testing',
      'debug',
      'git',
      'github',
      'lint',
      'typescript',
      'python',
      'rust',
      'golang',
      'java',
      'api',
      'sdk',
      'lsp',
      'commit',
    ],
  ],
  ['Utilities', ['utility', 'utilities', 'convert', 'format', 'clipboard', 'shell', 'terminal']],
]

const wordsOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  )

/** The Store category of a listing, from its source's category or else its own words. */
export function storeCategory(card: {
  category?: string | undefined
  tags: readonly string[]
  name: string
  summary: string
}): StoreCategory {
  const mapped = card.category ? CATEGORY_MAP[card.category.trim().toLowerCase()] : undefined
  if (mapped) return mapped
  const words = wordsOf([...card.tags, card.name, card.summary].join(' '))
  let best: StoreCategory = 'Other'
  let most = 0
  for (const [category, keywords] of KEYWORDS) {
    const found = keywords.filter((keyword) => words.has(keyword)).length
    if (found > most) {
      best = category
      most = found
    }
  }
  return best
}
