import type { WorkingPiece } from '../service-types'
import type { Golden } from './recommend-eval'

/**
 * THE GOLDEN CASES (`docs/internals/store.md`, "Measuring recommendations"), over the catalog in
 * `recommend-golden.ts`: what a person would recognize — a file open, a chat, what they
 * installed, a project — each with the packages that must, should and must not be shown.
 */

export interface GoldenCase extends Golden {
  name: string
  pieces?: WorkingPiece[]
  installed?: string[]
  project?: { files: string[]; dependencies: string[] }
}

const open = (label: string, content: string): WorkingPiece => ({ label, content, priority: 100 })

export const CASES: GoldenCase[] = [
  {
    name: 'a compose file is open',
    pieces: [
      open(
        'compose.yaml',
        'services:\n  web:\n    build: .\n    ports: ["3000:3000"]\n  db:\n    image: postgres:17\n    volumes: [db:/var/lib/postgresql/data]\n',
      ),
    ],
    must: ['docker-compose'],
    should: ['container-logs', 'postgres', 'kubernetes'],
    bad: ['fonts', 'music', 'weather', 'slides'],
  },
  {
    name: 'a Terraform file is open',
    pieces: [
      open(
        'main.tf',
        'resource "aws_s3_bucket" "assets" {\n  bucket = "acme-assets"\n}\nprovider "aws" { region = "eu-west-1" }\n',
      ),
    ],
    must: ['terraform'],
    should: ['aws-cli', 'kubernetes'],
    bad: ['fonts', 'music', 'charts'],
  },
  {
    name: 'a Python notebook script about sales data is open',
    pieces: [
      open(
        'analysis.py',
        'import pandas as pd\nimport matplotlib.pyplot as plt\n\nsales = pd.read_csv("sales.csv")\nsales.groupby("region")["revenue"].sum().plot.bar()\nplt.show()\n',
      ),
    ],
    must: ['pandas'],
    should: ['notebooks', 'charts', 'python-lsp'],
    bad: ['docker-compose', 'fonts', 'weather'],
  },
  {
    name: 'the chat asks for a quarterly deck',
    pieces: [
      {
        content:
          'Can you turn these Q3 numbers into a short presentation for the board? Revenue grew 18%, churn fell to 2.1%.',
        priority: 50,
      },
    ],
    must: ['slides'],
    should: ['charts', 'spreadsheets', 'docs-writer'],
    bad: ['docker-compose', 'rust-analyzer', 'redis'],
  },
  {
    name: 'two databases installed, nothing open',
    installed: ['postgres', 'mysql'],
    must: [],
    should: ['redis', 'mongodb', 'sql-formatter', 'prisma'],
    bad: ['music', 'weather', 'fonts'],
  },
  {
    name: 'a React project with Prisma and Sentry',
    project: {
      files: ['package.json', 'tsconfig.json', 'src'],
      dependencies: ['react', 'tailwindcss', 'prisma', '@sentry/react'],
    },
    must: ['prisma', 'sentry'],
    should: ['react-components', 'tailwind', 'storybook'],
    bad: ['music', 'weather', 'pandas'],
  },
  {
    name: 'a failing CI workflow is open',
    pieces: [
      open(
        'ci.yml',
        'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - run: bun test\n',
      ),
    ],
    must: ['github-actions'],
    should: ['jest-helper', 'security-scan'],
    bad: ['fonts', 'music', 'crm'],
  },
]
