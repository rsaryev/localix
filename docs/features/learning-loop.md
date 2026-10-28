# Carry context into later work

Localix keeps a memory folder per repository, agent definitions, reusable skills, and searchable
session transcripts for later work. Use them to preserve durable facts, repeat procedures, or
retrieve evidence from an earlier session.

**Boundary:** Localix loads stored context, but it does not extract every durable fact or workflow
automatically.

![A file-authored course open on its concept lesson, with theory, testing and practice steps](../assets/screenshots/learning/course--2026-10-08.png)

## What you can do

| Surface             | Mechanism                                                                              | Boundary                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Memory              | Keep facts in Claude Code's auto memory folder, one file each, indexed in `MEMORY.md`  | The agent saves with `Write` and `Edit`; `/memory` shows the folder or saves a fact                      |
| Skills              | Reuse project or global procedures stored as `SKILL.md` files                          | Saving is explicit or depends on the model choosing the `Skill` tool; see [Skills](skills.md)            |
| Session recall      | Discover sessions by full-text query, browse recent sessions, or page around a message | Recall requires `GlobalSearch`; transcripts are not injected on every turn                               |
| Learning Studio     | Build, import, export, and study file-authored courses                                 | The bundled `learning` mini app is enabled by default but can be disabled; courses belong to one session |
| Memory-provider API | Let one enabled mini app backend replace or append built-in prompt memory              | Provider calls are bounded and best-effort; a disabled app contributes nothing                           |

## How it works

### Memory

Memory is Claude Code's auto memory, in Claude Code's own folder, so a repository has the same
memory in both apps:

```text
~/.claude/projects/<project>/memory/
├── MEMORY.md          # the index: one line per memory
├── user-role.md       # one fact per file
└── deploy-days.md
```

`<project>` is the repository's main checkout with every character but letters and digits turned
into `-`, so every worktree and subfolder of a repository shares one folder; outside a repository it
is the working folder. `CLAUDE_CONFIG_DIR` moves the whole tree, and `autoMemoryDirectory` in your
own Claude Code settings names another folder (a repository's committed settings cannot).
`autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` turns memory off.

| Who                      | What it gets                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| A chat, a scheduled run  | The folder's path, how to save into it, and the first 200 lines or 25 KB of `MEMORY.md`  |
| A fork                   | Its parent's prompt, memory included                                                     |
| A subagent               | No project memory; an agent file's own `memory: user \| project \| local` folder instead |
| A run over SSH or Docker | No memory: its file tools cannot reach the folder                                        |

The agent saves a memory with the ordinary file tools: one fact per file, starting with frontmatter
(`name`, `description`, and `type: user | feedback | project | reference` under `metadata`), then a
one-line pointer in `MEMORY.md`. Writes into the run's own memory folder raise no permission card;
another project's folder still asks. Topic files are not loaded on their own: the agent reads one
with `Read` when the index says it matters.

| Command          | What it does                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| `/memory`        | Shows the session's memory folder and its `MEMORY.md`                            |
| `/memory <fact>` | Saves the fact as a file of its own and appends its pointer; no agent run starts |

### Prompt snapshots

Each session has a stored prompt snapshot for its context boundary. `MEMORY.md` and project
instructions normally stay frozen across later runs, including API restarts, as Claude Code loads
`MEMORY.md` once per session. A context checkpoint or a new session creates a fresh boundary; so
does a run in another repository, whose memory folder differs. Non-chat runs build fresh context
rather than using the chat snapshot. The bounded skill catalog also refreshes when its discovered
content or overrides change.

A memory saved mid-session is on disk at once, and the agent can `Read` it, while the frozen prompt
keeps the index it started with. Set `LOCALIX_FREEZE_CONTEXT=0` to rebuild the snapshot on each run.

### Recall and courses

`GlobalSearch` recalls past work. A `query` runs the search palette's own search — words, and
meaning when [semantic search](semantic-search.md) is on — with `domains` narrowing it to categories
such as messages or chats; `around_message_id` or `session_id` reads a bounded window of a
conversation; no arguments browse recent sessions. The tool returns previews and message identifiers
rather than replaying a full transcript.

Learning Studio validates course bundles authored under `.localix/learning-drafts/`, imports valid
content into the owning session's mini app data, and exposes the course hierarchy as session-scoped
resources. The agent reads the app's guide with `MiniAppGuide`; the bundle format and quality
checklist are its `course-bundle` page. Course creation, adaptation, import, export, and study
progress are explicit actions.

Courses prepare one complete module at a time. The first module is ready at activation; course
activity can request the next pending module once half the current module's lessons are completed
(rounded up) or its last lesson opens. Pending material refreshes in the reader when ready. Wake
delivery and preparation can fail, and automatic requests stop after three attempts per module. If
preparation stalls, ask a reachable tutor to inspect the failure and prepare the pending module in
the same course. Readiness is not guaranteed by a fixed deadline.

Quiz options use a stable shuffled order. The backend checks selected option ids and preserves
first-attempt scores across retries. Practice submission saves the solution and wakes the agent
through the common mini app host interface in the owning conversation. The agent records feedback
against the acceptance criteria; continuation requires a passing review. That review does not
complete the step for you. It is tied to the submitted attempt; repeated reviews keep the original
result, and an outdated submission cannot overwrite a newer one. Course prose and code fences use
the same Markdown renderer as conversation messages.

An external memory provider can run `loadContext` when a fresh chat prompt snapshot is built, for a
run that keeps memory. It may append to the `MEMORY.md` index or replace it in the prompt; the
folder and its files stay. The 8,000-code-unit cap applies to provider output; append mode can
produce a larger combined context with the index. Its `onRunEnd` hook receives each completed turn's
user and assistant text.

## Configuration

| Store or control         | Current boundary                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Memory                   | `~/.claude/projects/<project>/memory/`, or `autoMemoryDirectory`; index loads 200 lines or 25 KB |
| Memory off               | `autoMemoryEnabled: false` in Claude Code settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`       |
| Project skills           | `<workspace>/.claude/skills/<name>/SKILL.md`                                                     |
| Global skills            | `~/.claude/skills/<name>/SKILL.md`                                                               |
| Prompt snapshots         | `LOCALIX_FREEZE_CONTEXT=0` disables the default freeze                                           |
| External memory provider | First enabled provider only; 8,000-code-unit provider-output cap and 10-second timeout           |

## Limits

- A model may decide not to save a memory or a skill. Use `/memory <fact>`, agent instructions, or
  an explicit skill save when persistence is required.
- Memory folders are shared with Claude Code: what either app saves, the other loads.
- Memory Markdown is plaintext on disk. It is readable by processes with access to the same OS
  account and home directory.
- `GlobalSearch` must survive the active role and tool policy. Discovery also requires SQLite FTS5;
  an unavailable FTS table returns an error instead of falling back to transcript injection.
- A whole-tool denial without later argument exceptions removes `GlobalSearch` or `Skill` from the
  roster. Conditional rules can retain a tool while refusing individual calls. A run without `Write`
  and `Edit` keeps no memory.
- A memory provider's `onRunEnd` hook is fire-and-forget. Failure or timeout does not roll back the
  completed chat turn. A hook timeout stops waiting; its work can continue because the hook port has
  no abort signal.
- Learning Studio progress, files, and resources stay within the owning session. They are not
  promoted into memory or skills automatically.

## Related guides

- [Skills](skills.md)
- [Sessions and projects](sessions-and-projects.md)
- [Context checkpoints](context-checkpoints.md)
- [Mini apps](../extending/mini-apps.md)

## Source of truth

- [Memory folder, index loading and `/memory <fact>`](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/memory/auto-memory.ts)
- [Memory section](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/prompt/sections/memory.ts)
  and
  [the folders a run writes without a card](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/memory-roots.ts)
- [Persisted prompt snapshot and refresh exceptions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-snapshot.ts)
- [Agent prompt and provider admission](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-agent-context.ts)
- [Prompt loading](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-context.ts)
  and
  [snapshot cache](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/session-snapshot.ts)
- [History recall](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/history/history-search.ts)
- [`/memory` command](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers-listings.ts)
- [Skill tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/skill.ts)
  and
  [filesystem discovery](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-discovery.ts)
- [Completion hook invocation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/finalize.ts)
- [Memory provider lifecycle](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/memory-hooks.ts)
- [Learning mini app manifest](https://github.com/rsaryev/localix/blob/main/mini-apps/learning/mini-app.json),
  [course service](https://github.com/rsaryev/localix/blob/main/mini-apps/learning/backend/service.ts),
  and
  [resource provider](https://github.com/rsaryev/localix/blob/main/mini-apps/learning/backend/resource-provider.ts)
