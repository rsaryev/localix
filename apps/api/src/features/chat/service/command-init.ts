/**
 * `/init`: the instruction the agent receives. Claude Code's `/init` is a prompt too, so this
 * runs as an ordinary turn (tools, permissions and the person's approvals all apply) and the
 * file is written by the agent's own `write` and `edit`, which ask where they should.
 */
export const INIT_INSTRUCTION = `Write a CLAUDE.md at the root of this project, for the agents that will work in it after you.

Read first: the README, the package manifests, the build, lint and CI configuration, and the
instruction files that already exist (CLAUDE.md, AGENTS.md, .claude/rules, .cursorrules,
.github/copilot-instructions.md). Look at the code only as far as you need to understand how it
fits together.

What belongs in it:
- The commands to build, lint and run the tests, including how to run a single test.
- The architecture that takes reading several files to see: the parts, who owns what, and how
  they depend on each other.
- Conventions and constraints that differ from the defaults of the language and tools in use.

What does not: a list of every file or folder, advice any developer knows, generic sections
("Tips", "Common tasks"), and anything you did not verify in the project. Do not invent facts.

If a CLAUDE.md already exists, read it and improve it in place: keep what is right, fix what is
stale, add what is missing, and say what you changed. If an AGENTS.md exists, do not copy it:
begin CLAUDE.md with a line \`@AGENTS.md\` to import it, and add only what is specific to Claude
Code. Keep the file short enough to be read in full every session, and begin it with the line
"# CLAUDE.md" and one sentence that says what the project is.`
