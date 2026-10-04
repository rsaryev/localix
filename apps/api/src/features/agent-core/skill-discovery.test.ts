import { describe, it, expect, beforeAll, afterAll, spyOn } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverFilesystemSkills,
  splitTokenList,
  parseMarkdownFrontmatter,
  scalarField,
} from './skill-discovery'

describe('scalarField', () => {
  it('passes a string through and leaves undefined undefined', () => {
    expect(scalarField('hello')).toBe('hello')
    expect(scalarField(undefined)).toBeUndefined()
  })
  it('joins an array of values with a space (a YAML field given as a list)', () => {
    expect(scalarField(['a', 'b', 'c'])).toBe('a b c')
    expect(scalarField([])).toBe('')
  })
})

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'skills-'))
  const skillDir = join(dir, '.localix', 'skills', 'deploy-helper')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: deploy-helper\ndescription: Deploys the app\n---\n\n# Deploy\n\nRun the deploy script.',
  )

  // A skill with no frontmatter name → falls back to the directory name.
  const noName = join(dir, '.localix', 'skills', 'lint-fix')
  await fs.mkdir(noName, { recursive: true })
  await fs.writeFile(join(noName, 'SKILL.md'), '# Lint Fix\n\nFix lint errors.')

  // A Claude Code skill using `when_to_use` (trigger phrases folded into description).
  const cc = join(dir, '.localix', 'skills', 'pdf-extract')
  await fs.mkdir(cc, { recursive: true })
  await fs.writeFile(
    join(cc, 'SKILL.md'),
    '---\nname: pdf-extract\ndescription: Extracts text from PDFs.\nwhen_to_use: Use when the user uploads a PDF or asks to read a PDF.\n---\n\nExtract the text.',
  )

  // A CC skill using `when-to-use` (hyphen form — same as when_to_use but different convention).
  const cc2 = join(dir, '.localix', 'skills', 'log-extract')
  await fs.mkdir(cc2, { recursive: true })
  await fs.writeFile(
    join(cc2, 'SKILL.md'),
    '---\nname: log-extract\ndescription: Extracts log entries.\nwhen-to-use: Use when the user asks to parse logs.\n---\n\nExtract the logs.',
  )

  // CC flags: disable-model-invocation, user-invocable, argument-hint, arguments.
  const flags = join(dir, '.localix', 'skills', 'private-skill')
  await fs.mkdir(flags, { recursive: true })
  await fs.writeFile(
    join(flags, 'SKILL.md'),
    '---\nname: private-skill\ndescription: Internal tool.\ndisable-model-invocation: true\nuser-invocable: false\nargument-hint: "[issue-number]"\narguments: issue branch\n---\n\nDeploy $issue to $branch.',
  )

  // CC argument-hint only (no flags).
  const hinted = join(dir, '.localix', 'skills', 'deploy-with-hint')
  await fs.mkdir(hinted, { recursive: true })
  await fs.writeFile(
    join(hinted, 'SKILL.md'),
    '---\nname: deploy-with-hint\ndescription: Deploy skill.\nargument-hint: "[env] [tag]"\narguments: env tag\n---\n\nDeploy $env with $tag.',
  )

  // CC context:fork + agent + model + effort + paths.
  const forked = join(dir, '.localix', 'skills', 'research-fork')
  await fs.mkdir(forked, { recursive: true })
  await fs.writeFile(
    join(forked, 'SKILL.md'),
    '---\nname: research-fork\ndescription: Runs research in a sub-agent.\ncontext: fork\nagent: Explore\nmodel: sonnet\neffort: high\npaths: src/**/*.ts\n---\n\nResearch $ARGUMENTS thoroughly.',
  )

  // Keyword triggers: comma-separated, so a phrase may contain spaces.
  const keyed = join(dir, '.localix', 'skills', 'deploy-guide')
  await fs.mkdir(keyed, { recursive: true })
  await fs.writeFile(
    join(keyed, 'SKILL.md'),
    '---\nname: deploy-guide\ndescription: How to deploy.\nkeywords: deploy to prod, rollback\n---\n\nCheck the runbook first.',
  )

  // Block-list YAML frontmatter (CC style) — allowed-tools and arguments as block lists.
  const blockList = join(dir, '.localix', 'skills', 'block-list-skill')
  await fs.mkdir(blockList, { recursive: true })
  await fs.writeFile(
    join(blockList, 'SKILL.md'),
    '---\nname: block-list-skill\ndescription: A skill using block-list YAML.\nallowed-tools:\n  - Read\n  - Bash(git *)\n  - Write\narguments:\n  - target\n  - branch\n---\n\nDeploy $target to $branch.',
  )

  // Mixed: some fields inline, some block-list.
  const mixed = join(dir, '.localix', 'skills', 'mixed-skill')
  await fs.mkdir(mixed, { recursive: true })
  await fs.writeFile(
    join(mixed, 'SKILL.md'),
    '---\nname: mixed-skill\ndescription: Mixed inline and block-list.\nallowed-tools:\n  - Read\n  - Bash(git log *)\ndisallowed-tools: Write Edit\npaths: src/**\n---\n\nMixed skill body.',
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('parseMarkdownFrontmatter', () => {
  it('parses basic frontmatter and body', () => {
    const { fields, body } = parseMarkdownFrontmatter(
      '---\nname: test\ndescription: A test skill\n---\n\nBody here.',
    )
    expect(fields.name).toBe('test')
    expect(fields.description).toBe('A test skill')
    expect(body).toBe('Body here.')
  })

  it('returns empty fields + raw body when no frontmatter', () => {
    const { fields, body } = parseMarkdownFrontmatter('Just a body.')
    expect(Object.keys(fields)).toHaveLength(0)
    expect(body).toBe('Just a body.')
  })

  it('strips UTF-8 BOM before parsing', () => {
    const withBom = '﻿---\nname: bom-test\n---\n\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(withBom)
    expect(fields.name).toBe('bom-test')
    expect(body).toBe('Body.')
  })

  it('normalizes CRLF line endings (Windows)', () => {
    const crlf = '---\r\nname: win-test\r\n---\r\n\r\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(crlf)
    expect(fields.name).toBe('win-test')
    expect(body).toBe('Body.')
  })

  it('strips quotes from values', () => {
    const { fields } = parseMarkdownFrontmatter('---\ndescription: "quoted value"\n---\n\nb')
    expect(fields.description).toBe('quoted value')
  })

  it('parses block-list values as string arrays', () => {
    const src = '---\nname: my-skill\nallowed-tools:\n  - Read\n  - Bash(git *)\n---\n\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(src)
    expect(fields.name).toBe('my-skill')
    expect(fields['allowed-tools']).toEqual(['Read', 'Bash(git *)'])
    expect(body).toBe('Body.')
  })

  it('parses block-list arguments as string arrays', () => {
    const src = '---\nname: s\narguments:\n  - target\n  - branch\n---\n\nBody.'
    const { fields } = parseMarkdownFrontmatter(src)
    expect(fields.arguments).toEqual(['target', 'branch'])
  })

  it('scalar fields remain strings when block-list is absent', () => {
    const src = '---\nname: plain\ndescription: A plain skill\n---\n\nBody.'
    const { fields } = parseMarkdownFrontmatter(src)
    expect(typeof fields.name).toBe('string')
    expect(fields.name).toBe('plain')
  })

  it('folds a multi-line scalar (value on indented continuation lines) into one string', () => {
    // Regression: a `description:` whose value sat on the next indented line(s) used to
    // parse as '' — silently dropping the description in skill validation AND selection.
    const src =
      '---\nname: jwt\ndescription:\n  JWT and OIDC security testing covering token forgery,\n  algorithm confusion, and claim manipulation\n---\n\nBody.'
    const { fields } = parseMarkdownFrontmatter(src)
    expect(fields.description).toBe(
      'JWT and OIDC security testing covering token forgery, algorithm confusion, and claim manipulation',
    )
    expect(fields.name).toBe('jwt')
  })

  it('preserves newlines for a `|` literal block scalar and folds a `>` block scalar', () => {
    const literal = parseMarkdownFrontmatter('---\ntext: |\n  line one\n  line two\n---\n\nB.')
    expect(literal.fields.text).toBe('line one\nline two')
    const folded = parseMarkdownFrontmatter('---\ntext: >\n  line one\n  line two\n---\n\nB.')
    expect(folded.fields.text).toBe('line one line two')
  })

  it('an empty scalar with no continuation stays an empty string', () => {
    const { fields } = parseMarkdownFrontmatter('---\nname: n\ndescription:\n---\n\nBody.')
    expect(fields.description).toBe('')
    expect(fields.name).toBe('n')
  })

  it('handles block-list with BOM and CRLF', () => {
    const src = '﻿---\r\nallowed-tools:\r\n  - Read\r\n  - Write\r\n---\r\n\r\nBody.'
    const { fields, body } = parseMarkdownFrontmatter(src)
    expect(fields['allowed-tools']).toEqual(['Read', 'Write'])
    expect(body).toBe('Body.')
  })
})

describe('splitTokenList', () => {
  it('splits space-separated tokens', () => {
    expect(splitTokenList('read write bash')).toEqual(['read', 'write', 'bash'])
  })
  it('splits comma-separated tokens', () => {
    expect(splitTokenList('Read, Grep, Bash')).toEqual(['Read', 'Grep', 'Bash'])
  })
  it('handles YAML inline array', () => {
    expect(splitTokenList('[read, write]')).toEqual(['read', 'write'])
  })
  it('keeps Bash(git *) as a single token', () => {
    expect(splitTokenList('Bash(git *) Read')).toEqual(['Bash(git *)', 'Read'])
  })
  it('handles quoted YAML array', () => {
    expect(splitTokenList('["Read", "Grep"]')).toEqual(['Read', 'Grep'])
  })
  it('returns undefined for empty input', () => {
    expect(splitTokenList('')).toBeUndefined()
    expect(splitTokenList(undefined)).toBeUndefined()
  })
})

describe('discoverFilesystemSkills', () => {
  it('extracts description from first body line when frontmatter description is absent', async () => {
    const skills = await discoverFilesystemSkills(dir)
    // lint-fix has no frontmatter → description should come from the first line "# Lint Fix"
    const lint = skills.find((s) => s.name === 'lint-fix')
    expect(lint).toBeDefined()
    // First body line is "# Lint Fix" → extracted as "Lint Fix" (header stripped)
    expect(lint!.description).toBe('Lint Fix')
  })

  it('discovers .localix SKILL.md files with frontmatter', async () => {
    const skills = await discoverFilesystemSkills(dir)
    const deploy = skills.find((s) => s.name === 'deploy-helper')
    expect(deploy).toBeDefined()
    expect(deploy!.description).toBe('Deploys the app')
    expect(deploy!.content).toContain('Run the deploy script')
    expect(deploy!.scope).toBe('project')
  })

  it('falls back to the directory name when frontmatter has no name', async () => {
    const skills = await discoverFilesystemSkills(dir)
    expect(skills.find((s) => s.name === 'lint-fix')).toBeDefined()
  })

  it("folds a Claude Code skill's when_to_use into the description", async () => {
    const skills = await discoverFilesystemSkills(dir)
    const pdf = skills.find((s) => s.name === 'pdf-extract')
    expect(pdf).toBeDefined()
    expect(pdf!.description).toBe(
      'Extracts text from PDFs. Use when the user uploads a PDF or asks to read a PDF.',
    )
  })

  it('folds when-to-use (hyphen) into description (same as when_to_use underscore)', async () => {
    const skills = await discoverFilesystemSkills(dir)
    const log = skills.find((s) => s.name === 'log-extract')
    expect(log).toBeDefined()
    expect(log!.description).toBe('Extracts log entries. Use when the user asks to parse logs.')
  })

  it('parses CC disable-model-invocation, user-invocable, argument-hint, and arguments', async () => {
    const skills = await discoverFilesystemSkills(dir)
    const priv = skills.find((s) => s.name === 'private-skill')
    expect(priv).toBeDefined()
    expect(priv!.disableModelInvocation).toBe(true)
    expect(priv!.userInvocable).toBe(false)
    expect(priv!.argumentHint).toBe('[issue-number]')
    expect(priv!.argumentNames).toEqual(['issue', 'branch'])
  })

  it('threads argument-hint and arguments for a normal skill', async () => {
    const skills = await discoverFilesystemSkills(dir)
    const d = skills.find((s) => s.name === 'deploy-with-hint')
    expect(d).toBeDefined()
    expect(d!.argumentHint).toBe('[env] [tag]')
    expect(d!.argumentNames).toEqual(['env', 'tag'])
    expect(d!.disableModelInvocation).toBeUndefined()
    expect(d!.userInvocable).toBeUndefined()
  })

  it('parses context:fork, agent, model, effort, and paths frontmatter', async () => {
    const skills = await discoverFilesystemSkills(dir)
    const f = skills.find((s) => s.name === 'research-fork')
    expect(f).toBeDefined()
    expect(f!.contextFork).toBe(true)
    expect(f!.forkAgent).toBe('Explore')
    expect(f!.preferredModel).toBe('sonnet')
    expect(f!.preferredEffort).toBe('high')
    expect(f!.activationPaths).toEqual(['src/**/*.ts'])
  })

  it('parses keyword triggers, keeping multi-word phrases intact', async () => {
    const skills = await discoverFilesystemSkills(dir)
    const k = skills.find((s) => s.name === 'deploy-guide')
    // Split on commas, NOT whitespace: a trigger phrase is the useful case ("deploy to prod"
    // should not fire on the word "to").
    expect(k!.keywords).toEqual(['deploy to prod', 'rollback'])
  })

  it('returns nothing for a dir without skills (only scans home as global)', async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), 'empty-'))
    const skills = await discoverFilesystemSkills(empty)
    expect(skills.every((s) => s.scope === 'global')).toBe(true)
    await fs.rm(empty, { recursive: true, force: true })
  })

  it('does not pull hidden skills from ancestor directories', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'skill-root-'))
    const home = await fs.mkdtemp(join(tmpdir(), 'skill-home-'))
    const nested = join(root, 'packages', 'app')
    const ancestorSkill = join(root, '.localix', 'skills', 'ancestor-only')
    await fs.mkdir(nested, { recursive: true })
    await fs.mkdir(ancestorSkill, { recursive: true })
    await fs.writeFile(
      join(ancestorSkill, 'SKILL.md'),
      '---\nname: ancestor-only\ndescription: hidden ancestor\n---\nBody.',
    )

    const skills = await discoverFilesystemSkills(nested, home)
    expect(skills.find((skill) => skill.name === 'ancestor-only')).toBeUndefined()

    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(home, { recursive: true, force: true })
  })
})

describe('foreign Claude discovery is disabled', () => {
  let cdir: string
  beforeAll(async () => {
    cdir = await fs.mkdtemp(join(tmpdir(), 'cmds-'))
    // .claude/commands/deploy.md → /deploy prompt-command skill.
    const cmds = join(cdir, '.claude', 'commands')
    await fs.mkdir(cmds, { recursive: true })
    await fs.writeFile(
      join(cmds, 'deploy.md'),
      '---\ndescription: Deploy the app\nargument-hint: "[env]"\nmodel: opus\ndisable-model-invocation: true\n---\n\nDeploy $ARGUMENTS to production.',
    )
    // A command whose name collides with a real skill — the skill must win.
    await fs.writeFile(
      join(cmds, 'shared.md'),
      '---\ndescription: COMMAND version\n---\nCommand body.',
    )
    const skillDir = join(cdir, '.claude', 'skills', 'shared')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: shared\ndescription: SKILL version\n---\nSkill body.',
    )
    const agentsSkill = join(cdir, '.agents', 'skills', 'agents-only')
    await fs.mkdir(agentsSkill, { recursive: true })
    await fs.writeFile(
      join(agentsSkill, 'SKILL.md'),
      '---\nname: agents-only\ndescription: Must be imported explicitly\n---\nForeign body.',
    )
  })
  afterAll(async () => {
    await fs.rm(cdir, { recursive: true, force: true })
  })

  it('does not discover .claude/commands/*.md', async () => {
    const skills = await discoverFilesystemSkills(cdir)
    expect(skills.find((s) => s.name === 'deploy')).toBeUndefined()
  })

  it('does not discover .claude/skills', async () => {
    const skills = await discoverFilesystemSkills(cdir)
    expect(skills.find((s) => s.name === 'shared')).toBeUndefined()
  })

  it('does not discover .agents/skills', async () => {
    const skills = await discoverFilesystemSkills(cdir)
    expect(skills.find((s) => s.name === 'agents-only')).toBeUndefined()
  })

  it('follows a symlinked skill directory', async () => {
    const linkRoot = await fs.mkdtemp(join(tmpdir(), 'symlink-'))
    // Real skill lives outside the skills container; a symlink points at it.
    const realSkill = join(linkRoot, 'external', 'formatter')
    await fs.mkdir(realSkill, { recursive: true })
    await fs.writeFile(
      join(realSkill, 'SKILL.md'),
      '---\nname: formatter\ndescription: Formats code\n---\nFormat it.',
    )
    const container = join(linkRoot, '.localix', 'skills')
    await fs.mkdir(container, { recursive: true })
    await fs.symlink(realSkill, join(container, 'formatter'), 'dir')

    const skills = await discoverFilesystemSkills(linkRoot)
    expect(skills.find((s) => s.name === 'formatter')?.description).toBe('Formats code')
    await fs.rm(linkRoot, { recursive: true, force: true })
  })
})

describe('nested foreign Claude commands remain undiscovered', () => {
  let ndir: string
  beforeAll(async () => {
    ndir = await fs.mkdtemp(join(tmpdir(), 'cmd-ns-'))
    const cmds = join(ndir, '.claude', 'commands')
    // Nested: commands/git/commit.md → /git:commit (frontmatter name is display-only).
    await fs.mkdir(join(cmds, 'git'), { recursive: true })
    await fs.writeFile(
      join(cmds, 'git', 'commit.md'),
      '---\nname: totally-ignored\ndescription: Commit staged changes\n---\n\nCommit with a good message.',
    )
    // Deeper nesting: commands/db/migrations/run.md → /db:migrations:run
    await fs.mkdir(join(cmds, 'db', 'migrations'), { recursive: true })
    await fs.writeFile(
      join(cmds, 'db', 'migrations', 'run.md'),
      '---\ndescription: Run DB migrations\n---\n\nRun them.',
    )
    // Top-level still un-namespaced: commands/deploy.md → /deploy
    await fs.writeFile(join(cmds, 'deploy.md'), '---\ndescription: Deploy\n---\n\nDeploy it.')
    // .archive/ subdir must be skipped entirely.
    await fs.mkdir(join(cmds, '.archive'), { recursive: true })
    await fs.writeFile(join(cmds, '.archive', 'old.md'), '---\ndescription: Archived\n---\n\nOld.')
  })
  afterAll(async () => {
    await fs.rm(ndir, { recursive: true, force: true })
  })

  it('does not derive colon-namespaced commands', async () => {
    const skills = await discoverFilesystemSkills(ndir)
    expect(skills.find((s) => s.name === 'git:commit')).toBeUndefined()
    expect(skills.find((s) => s.name === 'totally-ignored')).toBeUndefined()
  })

  it('does not discover deeply nested command files', async () => {
    const skills = await discoverFilesystemSkills(ndir)
    expect(skills.find((s) => s.name === 'db:migrations:run')).toBeUndefined()
  })

  it('does not discover top-level commands', async () => {
    const skills = await discoverFilesystemSkills(ndir)
    expect(skills.find((s) => s.name === 'deploy')).toBeUndefined()
    expect(skills.find((s) => s.name === 'old')).toBeUndefined()
  })
})

describe('CC frontmatter tolerance (metadata / license / hide-from-slash-command-tool)', () => {
  let fdir: string
  beforeAll(async () => {
    fdir = await fs.mkdtemp(join(tmpdir(), 'fm-tol-'))
    // metadata is an arbitrary nested YAML map; license is a scalar; both must not break parsing.
    const std = join(fdir, '.localix', 'skills', 'standard-skill')
    await fs.mkdir(std, { recursive: true })
    await fs.writeFile(
      join(std, 'SKILL.md'),
      '---\nname: standard-skill\ndescription: Open-standard skill.\nlicense: Apache-2.0\nmetadata:\n  author: jane\n  category: build\n---\n\nDo the standard thing.',
    )
    // hide-from-slash-command-tool hides from the model listing, still user-invocable.
    const hidden = join(fdir, '.localix', 'skills', 'hidden-from-model')
    await fs.mkdir(hidden, { recursive: true })
    await fs.writeFile(
      join(hidden, 'SKILL.md'),
      '---\nname: hidden-from-model\ndescription: Hidden helper.\nhide-from-slash-command-tool: true\n---\n\nHelp quietly.',
    )
  })
  afterAll(async () => {
    await fs.rm(fdir, { recursive: true, force: true })
  })

  it('parses metadata + license without breaking; retains license, keeps a valid skill', async () => {
    const skills = await discoverFilesystemSkills(fdir)
    const std = skills.find((s) => s.name === 'standard-skill')
    expect(std).toBeDefined()
    expect(std!.description).toBe('Open-standard skill.')
    expect(std!.license).toBe('Apache-2.0')
    expect(std!.content).toContain('Do the standard thing.')
  })

  it('flags hide-from-slash-command-tool while keeping the skill discoverable', async () => {
    const skills = await discoverFilesystemSkills(fdir)
    const hidden = skills.find((s) => s.name === 'hidden-from-model')
    expect(hidden).toBeDefined()
    expect(hidden!.hideFromModel).toBe(true)
    // user-invocable is unaffected (not set to false)
    expect(hidden!.userInvocable).toBeUndefined()
  })
})

describe('exact skill scopes', () => {
  it('never claims the host console when no structured logger was injected', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'home-'))
    const proj = await fs.mkdtemp(join(tmpdir(), 'proj-'))
    for (const base of [home, proj]) {
      const dir = join(base, '.localix', 'skills', 'quiet-clash')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        join(dir, 'SKILL.md'),
        '---\nname: quiet-clash\ndescription: duplicate\n---\nBody.',
      )
    }
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await discoverFilesystemSkills(proj, home)
      // Count only this module's warnings. `console.warn` is process-wide and `bun test`
      // runs every file in one process, so a spy's window also collects whatever other
      // suites' pending async work logs — a raw call count is not this test's alone.
      expect(
        warn.mock.calls.filter((call) => String(call[0]).includes('[skills] duplicate name')),
      ).toHaveLength(0)
    } finally {
      warn.mockRestore()
      await fs.rm(home, { recursive: true, force: true })
      await fs.rm(proj, { recursive: true, force: true })
    }
  })

  it('a project sees only its own same-named skill', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'home-'))
    const proj = await fs.mkdtemp(join(tmpdir(), 'proj-'))
    const mk = async (base: string, label: string) => {
      const d = join(base, '.localix', 'skills', 'clash')
      await fs.mkdir(d, { recursive: true })
      await fs.writeFile(
        join(d, 'SKILL.md'),
        `---\nname: clash\ndescription: ${label}\n---\nBody ${label}.`,
      )
    }
    await mk(home, 'PERSONAL')
    await mk(proj, 'PROJECT')

    const warnings: Array<{ message: string; meta?: unknown }> = []
    const skills = await discoverFilesystemSkills(proj, home, {
      warn: (message, meta) => warnings.push({ message, meta }),
    })
    const clash = skills.filter((s) => s.name === 'clash')
    expect(clash).toHaveLength(1)
    expect(clash[0].description).toBe('PROJECT')
    expect(clash[0].scope).toBe('project')
    expect(warnings).toEqual([])

    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(proj, { recursive: true, force: true })
  })
})
