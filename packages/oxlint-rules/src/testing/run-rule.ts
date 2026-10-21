/**
 * Run one rule through the REAL linter and return what it reported.
 *
 * A hand-rolled tester would assert against our own idea of the AST, which is the thing most likely
 * to be wrong: these rules key on node shapes that oxlint's alpha JS-plugin layer produces, and
 * nothing else guarantees those shapes. So a test spawns `oxlint` over a fixture file with only the
 * rule under test enabled. It is slower than an in-process tester and it is the only version that
 * can fail for the right reason.
 *
 * The fixture keeps the RELATIVE path the caller asks for, because a rule may key on where a file
 * lives — an exemption list is not testable otherwise.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const PACKAGE_ROOT = resolve(import.meta.dir, '../..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')
const OXLINT = join(REPO_ROOT, 'node_modules/.bin/oxlint')
const PLUGIN_ENTRY = join(PACKAGE_ROOT, 'src/index.ts')

export interface Finding {
  rule: string
  message: string
  line: number
}

export interface RunRuleOptions {
  /** Fixture path relative to the temporary root. Rules that key on location need this. */
  filename?: string
}

interface OxlintSpan {
  line?: number
}

interface OxlintDiagnostic {
  message?: string
  code?: string
  labels?: { span?: OxlintSpan }[]
}

/** `localix(no-global-key-listener)` → `no-global-key-listener`, or `null` for another plugin. */
function ruleNameFrom(code: string | undefined): string | null {
  const match = /^localix\(([^)]+)\)$/u.exec(code ?? '')
  return match?.[1] ?? null
}

export async function runRule(
  rule: string,
  code: string,
  options: RunRuleOptions = {},
): Promise<Finding[]> {
  const root = await mkdtemp(join(tmpdir(), 'localix-oxlint-rule-'))
  try {
    const relative = options.filename ?? 'fixture.tsx'
    const target = join(root, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, code, 'utf8')
    await writeFile(
      join(root, '.oxlintrc.json'),
      JSON.stringify({
        // Only the rule under test may speak, so a finding cannot come from somewhere else.
        categories: { correctness: 'off' },
        jsPlugins: [PLUGIN_ENTRY],
        rules: { [`localix/${rule}`]: 'error' },
      }),
      'utf8',
    )

    const child = Bun.spawn([OXLINT, '-c', '.oxlintrc.json', '--format', 'json', relative], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
      killSignal: 'SIGKILL',
    })
    const stdout = await new Response(child.stdout).text()
    await child.exited

    const parsed = JSON.parse(stdout) as { diagnostics?: OxlintDiagnostic[] }
    return (parsed.diagnostics ?? []).flatMap((diagnostic) => {
      const name = ruleNameFrom(diagnostic.code)
      if (name === null) return []
      return [
        {
          rule: name,
          message: diagnostic.message ?? '',
          line: diagnostic.labels?.[0]?.span?.line ?? 0,
        },
      ]
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
