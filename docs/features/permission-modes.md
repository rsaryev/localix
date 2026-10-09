# Choose how much the agent asks

A conversation's permission mode decides whether the agent stops to ask before it acts. The mode's
icon sits in the composer strip beside the reasoning level and the turn budget; it opens a menu that
lists the four modes with what each one does.

## The four modes

| Mode           | What the agent may do                                                                                                                                    | Who answers questions                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Default**    | What the agent's own [permission rules](capabilities.md) say. An `ask` rule shows you a card.                                                            | You.                                                      |
| **Plan**       | Read, look, and change only this conversation's own state. Ordinary file, host, and external changes are blocked; its own plan Markdown is an exception. | You — and the agent presents a plan for you to approve.   |
| **Bypass**     | Tool calls proceed without permission cards when the remaining rules allow them. Denials still block.                                                    | You, for the agent's own questions (`ask`).               |
| **Autonomous** | Everything Bypass allows.                                                                                                                                | Nobody: questions and approval cards are refused at once. |

Three things no mode changes:

- **A denial stays a denial.** A rule that denies a tool or a command denies it in every mode. A
  mode never widens what an agent is.
- **The host-root guard stays active.** A mode cannot lift it. Opening the Localix checkout as the
  session project is its existing exemption; see
  [the host-root guard](permissions.md#the-host-root-guard).
- **Bypass and Autonomous still refuse catastrophic commands** — wiping a disk, a home directory or
  the machine — because "stop asking" is not "allow anything".

## How a mode works

A mode rewrites the agent's rules for this conversation's runs. The rules you see in Settings never
change.

- **Plan** appends denials for every call whose effect lands in files, in the agent's durable state
  (memory, skills, loops, plugins, configuration) or outside the machine. Reads, previews, and the
  conversation's own state — a board card, a game move, a queued question, a delegated explorer —
  stay allowed.
- **Bypass** removes tool `ask` rules about call classes, such as `outside-workspace` and
  `dangerous`, leaving the other rules to decide. It turns questions about a named tool or command
  into `allow` at the same position, then appends a denial for catastrophic commands. Plugin, skill,
  and agent admission rules are left unchanged.
- **Autonomous** does what Bypass does, then refuses every call that waits on a person, and tells
  tools that raise their own cards (secrets, configuration proposals) that nobody will answer.

A mode belongs to the whole conversation tree: a sub-agent the conversation delegates to runs under
the same mode, and changing the mode reaches every delegated session on its next run. A delegated
session's own button shows the mode but cannot change it.

A change takes effect on the next run. A run already in progress finishes under the mode it started
with; stop it if it must not continue.

## Review and approve a plan

In Plan mode the agent investigates, then presents a plan: a markdown document with the goal, the
approach, the steps, the risks and the open questions. Presenting ends its turn; nothing happens
until you decide.

The plan is a file in the conversation's working folder, so the agent revises it with small edits
instead of rewriting it, and you can open it like any other file:

| File                                    | Written by | What it is                                                    |
| --------------------------------------- | ---------- | ------------------------------------------------------------- |
| `.localix/plans/<conversation>/PLAN.md` | The agent  | The working draft the agent edits before presenting.          |
| `.localix/plans/<conversation>/v2.md`   | Localix    | Version 2 exactly as it was presented — the text you approve. |

`<conversation>` is the conversation's reference, such as `LOCALIX-42`. Only Markdown files directly
inside this conversation's own plan folder receive the Plan-mode file exception: writing another
conversation's `PLAN.md` counts as an ordinary file change and is refused, and a delegated agent
writes no plan file at all. The files belong to your project: deleting the conversation does not
delete them.

The exception covers Markdown files in that directory, not only `PLAN.md`. Version snapshots are
owned by Localix: the database version is authoritative, and the host rewrites a snapshot from it
when that version is touched. Editing a snapshot does not change the approved plan.

Each presentation snapshots the draft as the next version. Presenting text identical to the newest
version does not make a new one: if that version is waiting, nothing changes; if it was set aside,
the same version comes back for review; if it was already approved, the agent is told to edit the
draft to propose a change. The plan view says when the draft changed after the newest version and
has not been presented yet.

A strip above the composer shows the plan waiting for you — its version, its title and how many
comments you have written — and the plan opens in its own tab. The tab opens by itself at the moment
a version is presented or brought back for review, once per version; reloading the app or
reconnecting never opens it again. **Open** in the strip, or **Open plan** on the plan's card in the
transcript, brings it back after you close it.

If another window already decided on the version — you approve a plan that was approved meanwhile —
the strip updates to what happened and a short note says so ("Plan v2 was already approved"); no
error is recorded. Repeating a decision that already stands, such as approving again in the same
mode, changes nothing and wakes no one a second time.

| Action              | Where                                                  | What happens                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Comment**         | Select text in the plan tab                            | The comment is saved at once and marks the sentence. Edit or delete it from the mark or the comment count.                                                                                                    |
| **Request changes** | Strip, or the comment count in the tab                 | Sends your open comments to the agent, which revises the plan as a new version. Needs at least one open comment.                                                                                              |
| **Approve ▾**       | Strip, plan tab header, the attention dialog           | Pick the mode — Default, Bypass or Autonomous — and, in a chat with several agents, who starts: any agent (the default), one participant, or everyone. The conversation switches to that mode and wakes them. |
| **Dismiss**         | Strip                                                  | Puts the plan aside. The agent is not woken.                                                                                                                                                                  |
| **Back to review**  | Plan tab header, once the newest version was set aside | Brings that same version back for review and returns the conversation to Plan mode. Only the newest version.                                                                                                  |

Every version is kept. The tab's version menu switches between them, and **Changes** shows what the
selected version changed against the one before it. A version that is superseded or dismissed is
read-only. When a new version arrives, comments you had not sent move to it if their sentence is
still there; the rest are kept and listed as outdated rather than deleted.

An approved plan stays in the agent's instructions until it is completed or set aside, and the strip
shows "Implementing plan vN" meanwhile. When the work is done an agent marks the plan completed with
a short summary; it is told to say plainly when only part is done instead.

Every step of a plan is one line in the conversation, which you read and every agent in the
conversation reads too, and at most one Event Center entry:

| Stage             | What you see                                                                        | What the agent hears                                |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Mode changed      | "Permission mode: Plan — read-only until a plan is approved." (or the new mode)     | The same line                                       |
| Presented         | "@lead presented plan v2: Cache layer." and a **Review plan** entry waiting for you | The same line                                       |
| Changes requested | "Changes requested on plan v2 (3 comments)." The entry settles.                     | Your comments and note, as its next turn            |
| Approved          | "Plan v2 approved — Bypass mode." and who starts, if any. The entry settles.        | The agent you chose: the plan body and the go-ahead |
| Set aside         | "Plan v2 set aside." The entry settles.                                             | The same line; it is not woken                      |
| Left Plan mode    | "Plan v2 set aside: the conversation left Plan mode without approving it."          | The same line; it is not woken                      |
| Back for review   | "Plan v2 is back for review." and the **Review plan** entry again                   | The same line                                       |
| Continued         | "Plan v2 continued."                                                                | The plan body, and to check what is already done    |
| Completed         | "Plan v2 completed: <first line of the summary>", and an Event Center entry         | The approved plan leaves its instructions           |

While a version waits for review, choosing Default, Bypass or Autonomous in the composer's mode menu
asks which you mean: **Approve plan vN and implement** in that mode, or **Leave Plan mode and set
the plan aside**. Leaving sets the waiting version aside, because it was written for a read-only
conversation you have just ended — but that is the mode's doing, not yours, so switching back to
Plan mode brings the same version back for review, ready to approve. A version you dismissed
yourself stays dismissed until you choose **Back to review**.

Approving a plan is not a mode change of this kind — the plan is approved first, then the mode
switches. The completed entry interrupts according to your notification setting, like any finished
run.

If the agent could not be woken after a decision, the decision still stands and a notice says so —
send a message to continue.

### Continue a plan that stopped

While the agent works on an approved plan, the strip above the composer reads **Implementing plan
vN**. If the work stops before the plan is done — you pressed Stop, a reply failed, the app
restarted — nobody is working on it any more, and the strip says **Plan vN paused** with
**Continue**. Continue hands the plan back to the conversation: the agent gets the plan again,
checks what is already done, and carries on. The conversation shows "Plan vN continued.", and the
reply that follows is marked as started by Continue.

Continue appears only while nothing else is happening in the conversation: no reply running, no
message or wake waiting in the queue, no request waiting for you, and no delegated agent still
working. A plan the agent has completed, or that you set aside, offers nothing to continue.

Continue is not specific to plans. Any work the agent stopped on can offer it the same way, and each
kind appears in the same place with the same button.

### Who takes the approved plan

The plan belongs to the conversation, so approving it is something you say to the conversation, and
it is routed the way a message is. **Approve ▾** opens a menu like the composer's mode menu, with
two rows that each show their current choice:

- **Mode** (Default to start) opens the three modes, each with its icon and what it does.
- **Agent** (Any agent to start) opens **Any agent**, each participant with its avatar in its colour
  (the plan's author first, marked "Wrote the plan"), then **Everyone**. It appears only when the
  conversation has two or more participants; a one-agent chat has nobody to choose between.

Picking a choice updates its row and keeps the menu open; the **Approve** row at the bottom approves
with what the rows show.

| Agent                   | Who answers                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| Any agent (the default) | The agent a message with no `@mention` would go to. In a one-agent chat, it. |
| A participant           | That participant.                                                            |
| Everyone                | Every participant, each in turn.                                             |

When you name a participant or Everyone in a conversation with more than one, the approval line says
who starts — "Plan v2 approved — Bypass mode. @backend starts." — so every participant reads whose
turn the work is. Otherwise the line names only the mode. Approve does not add anyone to the
conversation: use **Add participant** in the composer first. The composer's mode menu approves with
the defaults: Any agent.

## How a call is judged

Each tool states, before a call runs, where that call's effect lands:

| Effect     | Meaning                                                                      |
| ---------- | ---------------------------------------------------------------------------- |
| `read`     | Observes; changes nothing.                                                   |
| `view`     | Changes only what you are looking at — a chart drawing, a preview pane.      |
| `session`  | Changes state this conversation owns and deletes with it.                    |
| `files`    | Writes or deletes files on disk.                                             |
| `host`     | Changes the agent's durable state beyond this conversation.                  |
| `external` | Reaches past the machine — processes, remote data, messages — or is unknown. |

A call may also be marked irreversible, or as waiting on a person. A tool that states nothing is
treated as `external`, the widest answer. The same classes are available to your own rules as
resources — `effect:files`, `effect:external`, `irreversible`, `needs-human` — so "ask before
anything irreversible" is one rule: `tool:*` over `irreversible` with effect `ask`.

## Related guides

- [Permission rules](permissions.md)
- [Human-in-the-loop requests](hitl.md)
- [Agent capabilities](capabilities.md)

## Source of truth

- [Mode vocabulary](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/permission-modes.ts)
- [Per-run mode rewrite](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/permission-mode-policy.ts)
- [Plan paths and file exception](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plans/plan-paths.ts)
- [Plan-file call classification](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/file/file-call-class.ts)
- [Plan presentation and snapshots](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plans/service-present.ts)
- [Plan approval](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plans/service-approve.ts)
- [Plan lifecycle notices](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plans/notices.ts)
