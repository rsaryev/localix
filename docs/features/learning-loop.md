# Carry context into later work

Localix stores explicit memory notes, agent definitions, reusable skills, and searchable session
transcripts for later work. Use them to preserve durable facts, repeat procedures, or retrieve
evidence from an earlier session.

**Boundary:** Localix loads stored context, but it does not extract every durable fact or workflow
automatically.

![A file-authored course open on its concept lesson, with theory, testing and practice steps](../assets/screenshots/learning/course--2026-10-08.png)

## What you can do

| Surface             | Mechanism                                                                              | Boundary                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Memory              | Store keyed Markdown notes at session, project, or global scope                        | Writes require `/memory` or the model-facing `memory` tool                                             |
| Skills              | Reuse project or global procedures stored as `SKILL.md` files                          | Saving is explicit or depends on the model choosing the `skill` tool; see [Skills](skills.md)          |
| Session recall      | Discover sessions by full-text query, browse recent sessions, or page around a message | Recall requires `history_search`; transcripts are not injected on every turn                           |
| Learning Studio     | Build, import, export, and study file-authored courses                                 | The bundled `learning` plugin is enabled by default but can be disabled; courses belong to one session |
| Memory-provider API | Let one enabled native plugin replace or append built-in prompt memory                 | Provider calls are bounded and best-effort; a disabled plugin contributes nothing                      |

## How it works

### Memory scopes

| Operation                           | Scope behavior                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `memory.set` without `scope`        | Writes to the project, or to the root session when no project exists                         |
| `memory.set` with `scope: "global"` | Writes a value visible across sessions                                                       |
| `memory.get`                        | Checks visible session, project, then global entries and returns the narrowest duplicate key |
| Prompt loading and `memory.list`    | Include entries from every visible scope; duplicate keys are not collapsed                   |
| `/memory <fact>`                    | Saves project memory when a project exists, otherwise global memory; no agent run starts     |
| Bare `/memory`                      | Lists project and global memory; session memory is not included                              |

Memory files use `## <key>` headings and optional `<!-- updated: ... -->` comments. A write that
would exceed one file's budget is rejected without changing that file.

### Prompt snapshots

A root chat snapshots visible memory, the skill roster, and project instructions on its first run.
`/clear`, a context checkpoint, or a new session creates a fresh boundary; child sessions load fresh
context instead of sharing the root snapshot.

Writes reach storage immediately. They normally reach the current root chat after its next context
boundary. Set `LOCALIX_FREEZE_CONTEXT=0` to rebuild the snapshot on each run.

### Recall and courses

`history_search` has three modes: a `query` performs SQLite FTS discovery grouped by session, a
`sessionId` reads a bounded window around a message, and no arguments browse recent sessions. The
tool returns previews and message identifiers rather than replaying a full transcript.

Learning Studio validates course bundles authored under `.localix/learning-drafts/`, imports valid
content into the owning session's plugin data, and exposes the course hierarchy as session-scoped
resources. Course creation, adaptation, import, export, and study progress are explicit actions.
Courses prepare one complete module at a time. The first module is ready at activation; the next
module starts preparing automatically halfway through the current module or when its last lesson
opens. Pending material refreshes in the reader when ready; wake delivery and preparation can fail,
so readiness is not guaranteed by a fixed deadline.

Quiz options use a stable shuffled order. The backend checks selected option ids and preserves
first-attempt scores across retries. Practice submission saves the solution and wakes the agent
through the common plugin host interface in the owning conversation. The agent records feedback
against the acceptance criteria; continuation requires a passing review. Course prose and code
fences use the same Markdown renderer as conversation messages.

An external memory provider can run `loadContext` when a fresh prompt snapshot is built and
`onRunEnd` after a completed turn. `loadContext` may append to built-in notes or replace their
prompt representation; it does not remove the built-in memory store or tool.

## Configuration

| Store or control         | Current boundary                                                              |
| ------------------------ | ----------------------------------------------------------------------------- |
| Global memory            | `~/.localix/memories/MEMORY.md`; 2,200-character budget                       |
| Project memory           | `~/.localix/memories/projects/<projectId>.md`; 2,200-character budget         |
| Session memory           | `~/.localix/memories/sessions/<rootSessionId>.md`; 1,500-character budget     |
| Project skills           | `<workspace>/.localix/skills/<name>/SKILL.md`                                 |
| Global skills            | `~/.localix/skills/<name>/SKILL.md`                                           |
| Prompt snapshots         | `LOCALIX_FREEZE_CONTEXT=0` disables the default freeze                        |
| External memory provider | First enabled provider only; 8,000-character output cap and 10-second timeout |

## Limits

- A model may decide not to call `memory` or `skill`. Use `/memory`, agent instructions, or an
  explicit skill save when persistence is required.
- Memory Markdown is plaintext on disk. It is readable by processes with access to the same OS
  account and home directory.
- `history_search` must survive the active role and tool policy. Discovery also requires SQLite
  FTS5; an unavailable FTS table returns an error instead of falling back to transcript injection.
- A scope that denies `memory`, `history_search`, or `skill` removes them from the tool roster.
  Built-in memory remains a separate prompt input.
- A memory provider's `onRunEnd` hook is fire-and-forget. Failure or timeout does not roll back the
  completed chat turn.
- Learning Studio progress, files, and resources stay within the owning session. They are not
  promoted into memory or skills automatically.

## Related guides

- [Skills](skills.md)
- [Sessions and projects](sessions-and-projects.md)
- [Context checkpoints](context-checkpoints.md)
- [Plugins](../extending/plugins.md)

## Source of truth

- [Memory tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/memory/memory.ts),
  [repository](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/memory/repository.ts),
  and
  [file format](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/memory/file-store.ts)
- [Prompt loading](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-context.ts)
  and
  [snapshot cache](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/session-snapshot.ts)
- [History recall](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/history/history-search.ts)
- [`/memory` command](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers-listings.ts)
- [Skill tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/skill.ts)
  and
  [filesystem discovery](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-discovery.ts)
- [Plugin memory lifecycle](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/memory-hooks.ts)
- [Learning plugin manifest](https://github.com/rsaryev/localix/blob/main/plugins/learning/plugin.json),
  [course service](https://github.com/rsaryev/localix/blob/main/plugins/learning/backend/service.ts),
  and
  [resource provider](https://github.com/rsaryev/localix/blob/main/plugins/learning/backend/resource-provider.ts)
