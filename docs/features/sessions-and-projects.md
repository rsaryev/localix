# Organize work with projects and sessions

Projects bind sessions to a working directory and project settings. Every session belongs to one — a
session you start without picking a project lands in **Default**, whose sessions each work in their
own directory under `~/.localix/workspace`. Use projects to separate codebases, preserve
conversation history, and return to the exact scope you were using.

**Navigation boundary:** the URL selects the current project, section, and session; changing scope
restores that scope's remembered location.

## What you can do

| Task                         | Mechanism                                                                              | Boundary                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Group work by repository     | Create a project backed by one working directory.                                      | Deleting a project HIDES it. Its sessions and rules stay; re-opening the directory brings it back. |
| Start work with no project   | Just start a chat — it lands in **Default**, which gives it its own scratch directory. | That directory is deleted with the chat; open a real project to keep files somewhere you own.      |
| Resume work                  | Switch by project, session tree, title search, or message search.                      | Message search starts at two characters and returns one result row per session.                    |
| Explore another response     | Regenerate or edit a message to create a sibling conversation branch.                  | Only one branch is active in the transcript at a time.                                             |
| Recover an unfinished reply  | Press **Retry** on the notice the transcript leaves in its place.                      | Offered only where re-running makes sense; the unfinished attempt is kept as a branch.             |
| Split work into another chat | Run `/fork` to copy the active message path into a linked child session.               | This is a conversation operation, not a Git branch operation.                                      |
| Retire or preserve a chat    | Archive, export, or permanently delete a session.                                      | Each action has a different retention boundary; see Limits.                                        |

## How it works

### Terms

| Term            | Meaning                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| Project         | A named scope bound to a working directory and optional project settings.            |
| Default project | The scope of a chat you never filed; its sessions get their own scratch directories. |
| Root session    | The top-level chat in a session hierarchy.                                           |
| Child session   | A linked chat created for delegation or by `/fork`.                                  |
| Message branch  | An alternate continuation inside one session transcript.                             |
| Session fork    | A new linked child session seeded from the active message path.                      |

### Scope and working directory

| Session state   | Base working directory                      | Boundary                                                        |
| --------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Project session | The project's configured working directory. | Sessions of one project share it; project settings apply there. |
| Default session | `~/.localix/workspace/<root-session-id>`.   | Created on demand, and deleted when that chat is deleted.       |

A project answers which SETTINGS apply and where things are installed; permission rules belong to
the agent, not the project. The working directory is a third question, which is why the sessions of
the **Default** project share one project and not one folder. Projects receive canonical IDs such as
`PRJ-1`; sessions receive canonical IDs such as `LOCALIX-1`. Parent links define the session tree,
and the root session anchors a hierarchy's directory: an explicitly spawned child and a fork work
beside the chat that spawned them. A chat's [Kanban](task-board.md) board is plugin data of that
chat: its cards create no child session, and deleting the chat deletes the board.

The breadcrumb renders the active scope, root session, and descendant path. The session switcher
opens with `Cmd/Ctrl+K`; the project switcher opens with `Cmd/Ctrl+Alt+P`.

Long paths scroll horizontally, keeping every ancestor reachable. Navigating to another session
reveals the end of its path automatically. Trackpad gestures and a mouse wheel both scroll the
trail.

### Who said it, and when

Every reply is headed by its author: a generated monogram tile, the agent's name in that agent's own
colour, and the wall-clock time. The colour is derived from the agent's handle, so it is the same
tile everywhere the agent appears and it survives a rename of the display label. Your own messages
carry their time in the row below them and no tile.

Consecutive replies from the same speaker are one run: the header appears on the first of them and
the rest carry only their content, with tighter spacing to say the voice has not changed. A run ends
on a different speaker, a pause of more than ten minutes, a new day, or any system notice between
them.

Each day starts with a divider naming it — Today, Yesterday, or the date. That is why a message's
own time is a bare clock: the day is stated once, above.

A message's actions (copy, link, branch, regenerate) appear when you point at it or move focus into
it, so a transcript reads as text rather than as rows of controls. On a touch screen, where there is
no hover, they are always visible.

### When a reply does not finish

Two things can cut a reply short: the backend restarting mid-run, and an error the same request
might survive — a dropped connection, a provider that was briefly overloaded. Both leave a line in
the transcript saying so, and that line carries a **Retry** button. It re-runs the turn the reply
belongs to, keeping the unfinished attempt as a sibling branch, so nothing is retyped and nothing is
overwritten.

The button appears only where retrying can work. An error that will repeat — a rejected key, a
refused request — leaves the reason and no button, because pressing one would only produce the same
refusal. When a tool was still running at the moment of the cut, the line names it and asks you to
check before retrying: a command that was dispatched and never reported back may have taken effect
already.

The tile and name are one link: selecting them opens that agent's **profile** as a workspace tab —
the same page a mention chip, a chat group's heading and the row in Settings → Agents open, in the
scope the record lives in. The profile is where the agent is read and edited, so it can sit beside
the conversation it is about. The header appears as soon as the reply starts, before its first
character, so a session with several agents says who is thinking.

### Reading the session list

The top navigation follows **workspace → chat → sub-session**. Its chat menu lists root
conversations in the selected workspace across all agents. The current location stays prominent;
ancestor labels are quieter and truncate first when space is limited.

A sidebar row shows the conversation title and when it was last active on one line. Main chats omit
decorative leading icons; sub-sessions keep their worker, thread or fork icon. A spinner marks an
agent that is working. Beside the timestamp, one status mark shows the most pressing item waiting
for your attention, otherwise an unread dot or a pin.

The actions button appears when you hover over a row or focus it with the keyboard, and stays
visible while its menu is open. On touch devices it is always visible. You can also right-click the
row to open the same actions. The button replaces the timestamp in the same slot, giving the title
more room without shifting it when actions appear. The status mark stays visible.

Sub-sessions appear beneath their actual parents, including nested delegations. The active chat's
branch opens by default; other root chats start folded. Each parent has its own disclosure arrow,
and a folded row shows its direct child count. Branches initially show five children, with **Show
all** for the rest. Opening a nested session reveals its full path, even beyond that preview. Title
search includes workers, threads and forks and temporarily expands matching paths; clearing the
search restores your folds.

**Show less** appears only for a branch with more than five children that is showing its full list.
Single-child chains use their disclosure arrows without additional footer rows.

### Conversation branches and forks

The composer's **Agent sessions** panel groups delegated sessions beneath their parents. Click a
session name to open it, or use the chevron beside a parent to fold that branch independently.
Folding keeps the parent visible and preserves any folds further down the tree. The header count
includes sessions in folded branches. Status dots remain visible for completed and failed runs;
running sessions also show their current activity and a Stop button.

Regenerating an assistant reply retains the earlier reply as a sibling branch and activates the new
one. Editing a user message creates another sibling branch with the prior active context, then
continues from the edit.

`/fork` creates a child session and copies the selected active message path in chronological order.
The child inherits the project, model, and pinned skills.

Generated fork titles use one suffix with the new conversation number, such as **Greeting
(fork 42)**. Forking that conversation replaces the suffix with the next fork's number. Legacy
repeated suffixes are condensed in the sidebar and breadcrumb without rewriting stored titles.

### Drafts and queued messages

Composer text drafts are kept per session in client memory. Staged attachments are cleared when the
active session changes so they cannot be sent to the wrong chat.

Messages sent while an agent is busy enter a durable SQLite queue. Plain text without attachments
may steer the running turn at a safe tool or model boundary; structured input and attachments wait
for a normal queued turn.

### Retention actions

| Action          | Result                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Archive         | Sets an archive timestamp and hides the session from the default list.                           |
| Export          | Serializes the active message path to Markdown in the client.                                    |
| Redacted export | Replaces tool items and structured bindings with typed placeholders.                             |
| Delete          | Stops active resources, removes the session and its direct children, and deletes their messages. |

## Configuration

| Setting or surface        | Effect                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| Project working directory | Sets the base directory for sessions in that project.                     |
| Project settings          | Applies optional project-scoped runtime configuration.                    |
| Pinned session            | Keeps the session in the pinned section of its scope.                     |
| Archived session          | Hides the session from normal navigation without deleting its transcript. |
| Session title             | Supplies the primary value for sidebar filtering and search results.      |

Provider connection, model, reasoning effort, pinned skills, hierarchy, and runtime status are
persisted per session where applicable.

## Limits

- Composer drafts are in memory and are lost on reload. Staged attachments are cleared when you
  switch sessions.
- Sessions in **Default** share one working directory. That is the trade for giving them a real
  project: a "no project" session would use the GLOBAL capability scope, so a rule switched in a
  throwaway chat would apply to the whole installation and nothing below could undo it.
- Deleting a project is a soft delete. The row, its sessions and its capability rules remain, and
  re-opening the same directory revives it rather than creating a second project for that path.
- **Default** cannot be deleted. It is where a chat you start without a project lands, so the next
  session would revive the same row anyway — deleting it only hid your own chats until something
  did. Renaming it is fine: which project is the default is decided by its directory, not its name.
- `/fork` copies only the active message path. It does not create a Git branch or include inactive
  message branches.
- Archive does not stop, export, or delete a session. It only changes its visibility in normal
  navigation.
- Standard and redacted exports include only the active message path. Redacted export replaces
  structured tool data but does not scan ordinary user or assistant prose for secrets.
- Session deletion is permanent. It removes the selected session and its direct children after
  best-effort runtime cleanup.
- Deleting a project hides it and its sessions rather than unfiling them. Re-adding the same
  directory brings the project and its transcripts back.
- Deleting a chat in **Default** deletes its scratch directory with it. Files you want to keep
  belong in a project whose directory you chose.

## Related guides

- [Your first session](../getting-started/first-session.md)
- [Workspace](workspace.md)
- [Delegation](delegation.md)
- [Context checkpoints](context-checkpoints.md)
- [Privacy and local data](../getting-started/privacy.md)

## Source of truth

- [Project contracts and canonical IDs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/projects/contracts.ts)
- [Project persistence and deletion behavior](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/projects/repository.ts)
- [Session contracts and persisted fields](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/contracts/session.ts)
- [Session working-directory resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/session-cwd.ts)
- [Message branching operations](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/branching-ops.ts)
- [Session fork](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/session-fork.ts)
- [Session lifecycle and deletion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/session-lifecycle.ts)
- [Durable agent queue](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue-store.ts)
- [URL-backed workspace navigation](https://github.com/rsaryev/localix/blob/main/apps/ui/src/pages/chat/model/useUrlStoreSync.ts)
