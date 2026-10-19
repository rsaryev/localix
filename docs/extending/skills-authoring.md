# Author a skill

A skill is a directory whose `SKILL.md` gives the agent a reusable procedure. Use one to keep a
prompt, its scripts, and its reference files together in project or personal scope.

The [skills guide](../features/skills.md) owns discovery, pinning, Settings, and day-to-day use.
This page defines the package format and the behavior of each authoring field.

## What you can do

| Task                       | Mechanism                                          | Boundary                                                                      |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Write a reusable procedure | Put instructions in a `SKILL.md` body.             | A skill guides the agent; it does not run until selected, invoked, or pinned. |
| Accept arguments           | Use positional, named, or session placeholders.    | Substitution is textual and happens once.                                     |
| Gather live context        | Embed a bounded `!` command in a filesystem skill. | The command runs during explicit slash preprocessing in the resolved shell.   |
| Include a file             | Reference `@path` from a filesystem skill.         | The resolved file must stay inside the working directory or skill directory.  |
| Fork the procedure         | Set `context: fork`.                               | Model and effort hints affect this forked path only.                          |
| Narrow an inline run       | Declare allowed or disallowed tools.               | These overrides apply to an inline slash invocation, not a fork or a pin.     |
| Ship a read-only procedure | Put the same directory under a plugin skill root.  | Model retrieval and agent preloads use the stored body without preprocessing. |

## How it works

### Terms

| Term             | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| Skill            | A parsed `SKILL.md` plus its containing directory.                      |
| Filesystem skill | A skill in a Localix root or the project's portable `.agents/skills`.   |
| Plugin skill     | A read-only skill contributed by an enabled plugin.                     |
| Model roster     | Skill names and descriptions shown to the model for possible selection. |
| Slash invocation | An explicit `/<skill-name> [arguments]` request.                        |
| Pin              | A session record that injects the full skill body on later runs.        |
| Forked skill     | A slash invocation executed in a detached child session.                |

### Package layout

```text
.localix/skills/
  deploy-staging/
    SKILL.md
    scripts/
      deploy.sh
    references/
      checklist.md
```

`SKILL.md` is an optional YAML frontmatter block followed by Markdown instructions. `name` falls
back to the directory name. `description` falls back to the first meaningful body line.

```markdown
---
name: deploy-staging
description: Deploy the current revision to staging and verify it.
argument-hint: '[service]'
arguments: service
allowed-tools: Bash(deploy *) Read
---

Run `./scripts/deploy.sh $service`, then check @references/checklist.md.
```

Keep instructions operational: name inputs, commands, expected evidence, and stopping conditions.
Relative script paths are interpreted by the agent or shell command you author; Localix does not
automatically execute files merely because they sit beside `SKILL.md`.

### Discovery and write scope

| Session scope | Directories scanned                                                               | Precedence                         |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------- |
| Project       | `<working-directory>/.localix/skills`, `.agents/skills`, then `~/.localix/skills` | Native project, portable, personal |
| Default       | `~/.localix/skills`                                                               | Personal filesystem skills         |

The project scan uses the session's exact working directory; it does not search parent projects.
Localix writes and deletes only its own `.localix/skills` entries. A portable skill can be shadowed
by saving a native copy with the same name.

The scanner accepts nested skill directories within the selected root. It ignores archive folders,
caps traversal at six levels and 2,000 entries, and reads regular UTF-8 `SKILL.md` files up to 1
MiB.

Project symlinks must resolve inside the working directory; personal skill symlinks may point
outside the home directory. Plugin skill links stay inside their declared skill root. Once a
directory contains `SKILL.md`, the container scan treats it as one skill and does not descend into
its assets for nested skills.

### Invocation pipeline

An explicit filesystem-skill slash invocation follows this order:

1. Resolve the skill and reject it when `user-invocable: false`.
2. Expand bounded `!` shell commands.
3. Expand confined `@path` file references.
4. Substitute arguments and session placeholders.
5. Run inline with tool overrides, or start a child session for `context: fork`.

Current slash resolution uses filesystem skills. Plugin skills are available through model retrieval
and agent-profile preloads. A pinned or keyword-triggered skill takes a separate path: its stored
body enters the prompt without the slash preprocessing pipeline, including tool overrides, fork
routing, or skill hooks.

The system prompt can suggest saving a repeatable workflow through the `skill` tool. Saving is a
model decision or an explicit user request, not a guaranteed post-run action.

## Configuration

### Frontmatter reference

| Field                          | Accepted value           | Effect                                                                 | Boundary                                                                                                      |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`                         | string; directory name   | Sets the discovered and slash-command name.                            | Filesystem write APIs accept letters, digits, `_`, and `-`, starting with an alphanumeric character.          |
| `description`                  | string; first body line  | Supplies roster and slash-menu text.                                   | `when_to_use` or `when-to-use` text is appended when present.                                                 |
| `when_to_use`, `when-to-use`   | string                   | Adds selection guidance to the description.                            | It does not create a separate matching engine.                                                                |
| `argument-hint`                | string                   | Shows argument placeholder text in the composer.                       | Display metadata only.                                                                                        |
| `arguments`                    | token list               | Names positional values for `$name` substitution.                      | Use names matching `[A-Za-z_][A-Za-z0-9_]*`; numeric and reserved names conflict with built-in substitutions. |
| `disable-model-invocation`     | boolean; `false`         | Hides the skill from the model roster.                                 | Explicit slash invocation and pinning still load it.                                                          |
| `hide-from-slash-command-tool` | boolean; `false`         | Also hides the skill from the model roster.                            | Despite the field name, explicit slash invocation remains available.                                          |
| `user-invocable`               | boolean; `true`          | Controls direct slash invocation.                                      | `false` leaves the skill in the model roster.                                                                 |
| `allowed-tools`                | token list               | Auto-approves matching tools for an inline slash run.                  | Ignored by forked and pinned execution paths.                                                                 |
| `disallowed-tools`             | token list               | Removes matching tools from an inline slash run.                       | Ignored by forked and pinned execution paths.                                                                 |
| `paths`                        | glob token list          | Filters model-roster visibility against the session working directory. | Explicit slash invocation and pinning do not use this filter.                                                 |
| `keywords`                     | phrase list              | Injects the body when the latest user message contains a phrase.       | Case-insensitive word-boundary matching; roster hiding does not disable it, but agent skill denial does.      |
| `context`                      | `fork`                   | Starts the skill in a detached child session.                          | Any other value uses the inline path.                                                                         |
| `agent`                        | role name                | No longer honoured: a fork runs as the agent that invoked the skill.   | Validation warns when it names an agent; `general-purpose` is accepted silently.                              |
| `model`                        | model id or family alias | Requests the child model for `context: fork`.                          | Ignored for inline runs; routing can still reject or resolve the request.                                     |
| `effort`                       | effort name              | Requests child reasoning effort for `context: fork`.                   | Unrecognized values inherit; ignored for inline runs.                                                         |
| `hooks`                        | nested hook map          | Activates skill-scoped hooks for the invocation window.                | The chat dispatcher executes them; the frontmatter parser only retains the map.                               |
| `shell`                        | string                   | Retains a shell preference for compatibility.                          | Parsed but not used; dynamic commands run through the agent's Bash (`bash -c`; Git Bash on Windows).          |
| `version`                      | string                   | Records a version.                                                     | Informational only.                                                                                           |
| `license`                      | string                   | Retains license metadata.                                              | Informational only.                                                                                           |
| `metadata`                     | YAML map                 | Keeps the file parse-tolerant when metadata is present.                | Not surfaced on the discovered skill or used at runtime.                                                      |

Token lists accept a YAML list, an inline array, or comma- or space-separated text. Parenthesized
tool patterns remain one token, so `Bash(git *)` is not split at its space.

`keywords` uses comma-separated phrases or a YAML list; spaces within a phrase are preserved.
Keyword injection has its own 32,000-code-unit body budget and skips already pinned names. It adds
instructions to the prompt; it does not guarantee that the model follows them or record curator use.

`${CLAUDE_PROJECT_DIR}` inside an `allowed-tools` value resolves before the auto-approval rule is
created.

### Optional package policy

An adjacent `agents/openai.yaml` can disable implicit selection without changing `SKILL.md`:

```yaml
policy:
  allow_implicit_invocation: false
```

This setting hides the skill from the model roster. Explicit slash invocation and pinning remain
available. Missing, malformed, oversized, non-UTF-8, or escaping policy files are ignored.

### Argument and session substitutions

| Token                   | Expansion                                           |
| ----------------------- | --------------------------------------------------- |
| `$ARGUMENTS`            | Full argument string.                               |
| `$ARGUMENTS[N]`         | Zero-based token parsed with quote-aware splitting. |
| `$N`                    | Short form of `$ARGUMENTS[N]`.                      |
| `$name`                 | Positional value assigned by the `arguments` list.  |
| `${CLAUDE_SKILL_DIR}`   | Directory containing this `SKILL.md`.               |
| `${CLAUDE_SESSION_ID}`  | Current session id.                                 |
| `${CLAUDE_EFFORT}`      | Current reasoning effort.                           |
| `${CLAUDE_PROJECT_DIR}` | Session working directory.                          |

An unknown named placeholder stays unchanged. When a body contains no argument placeholder, Localix
appends a short `Arguments:` section for a non-empty argument string.

### Dynamic command context

Use an inline or fenced `!` form to insert stdout before the agent sees a filesystem skill:

````markdown
Changed files: !`git diff --name-only HEAD~1`

```!
git status --short
git log --oneline -5
```
````

Commands run in the session working directory. Localix injects the four `CLAUDE_*` values listed
above, runs at most 16 commands with concurrency four, and allows ten seconds and 32 KiB per
command. Aggregate inserted stdout is capped at 64 KiB. Failures become visible error text in the
skill body.

Shell expansion is single-pass: output cannot start more `!` commands. It does pass through the
later file-reference and argument stages, so an emitted `@path` or `$ARGUMENTS` can still expand.
These preprocessing commands spawn directly before the agent run; they do not pass through Bash tool
approval or the skill's inline tool overrides.

### File references

An `@path` at line start or after whitespace, outside code spans and fences, can inline a text file:

```markdown
Follow @references/release-checklist.md and report each failed item.
```

Resolution tries the session working directory and the skill directory. Real-path checks keep the
target inside one of those roots. Each file is capped at 32 KiB; a run accepts at most 32
expansions, 128 candidates, and 128 KiB total. An unresolved reference stays literal.

### Validate and test

Use Settings or the `skill` tool to confirm discovery, then invoke the skill with representative
arguments. Test both a successful path and the failure condition described by the procedure.

For dynamic context, keep commands read-only where possible and test their timeout, empty-output,
and non-zero-exit behavior. For a forked skill, verify the invoking agent has every tool it needs.

## Limits

- Filesystem skill bodies and adjacent assets live on disk. Session pin names are stored in the
  session database, so the skill system is not entirely filesystem-only.
- Project and personal filesystem skills are merged, project first, so a repository's copy shadows a
  personal skill of the same name.
- Discovery does not scan other applications' skill or command directories.
- `shell` and `metadata` are accepted without runtime behavior. `version` and `license` are retained
  as information only.
- Tool overrides apply only to inline slash invocation. A fork uses the invoking agent's tool
  policy; a pin only injects instructions.
- Dynamic commands execute local code during slash preprocessing. They are not sandboxed beyond
  process, time, output, and count limits.
- Plugin skills are read-only through the skill tool. Disable the owning plugin or copy the skill to
  a writable filesystem scope before editing it.
- Pinned skill bodies share a 32,000-code-unit prompt budget. Content after the aggregate cap is
  truncated and replaced with an omission notice.

## Related guides

- [Use and manage skills](../features/skills.md)
- [Build plugins](plugins.md)
- [Hooks and commands](../features/hooks-and-commands.md)
- [The learning loop](../features/learning-loop.md)

## Source of truth

- [Frontmatter parser](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-frontmatter.ts)
- [Discovery precedence and writes](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-discovery.ts)
- [Bounded directory scanner](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-scan.ts)
- [Slash-command dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers.ts)
- [Dynamic command expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skill-commands.ts)
- [File-reference expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/file-references.ts)
- [Tool override mapping](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/tool-override-options.ts)
- [Model roster and pinned-skill prompt sections](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/prompt/sections/features.ts)
