# Manage notifications

The Event Center is the one journal of what happened while you were not looking: agent runs,
sub-agents and jobs, requests for your input, background terminals, problems the app or a plugin
found, and your own actions that failed. Every message the app shows about an event lands here and
stays until you clear it; errors and requests for input can also interrupt you on supported clients.
The answer to something you just did — "Copied", "Nothing to undo", "Branch already exists" — is not
an event: it appears for a few seconds beside the control you used and is never written here.

## What you can do

| Action                       | Mechanism                                                   | Boundary                                                         |
| ---------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Review recent activity       | Open the title-bar bell; entries appear newest first        | History is kept by the local server; every window shows the same |
| Read an entry in full        | Select the row; its body, actions and trace expand          | Expanding an entry marks it read                                 |
| Return to a source session   | Select the arrow on a row that names a session              | Application messages without a session are not navigable         |
| Answer a waiting request     | Select **Respond** on a human-input entry                   | The entry settles once the request is answered, expires or ends  |
| Retry a failed top-level run | Select **Retry** on the failure entry                       | Refused once a newer reply exists; settled by a later run        |
| Hand a problem to the agent  | Select **Send to agent** on a problem entry                 | Sends the report as written, fix hints included                  |
| Find an entry                | Search, or filter by status, event type, severity and time  | Search syntax is listed behind the **?** in the search field     |
| Manage unread state          | Expand an entry, open its chat, or select **Mark all read** | Opening the bell alone does not mark anything read               |
| Remove history               | Remove one entry, or select **Clear history**               | Clear keeps pending requests and problems that are still true    |
| Control interruptions        | Choose **Always**, **When app is inactive**, or **Never**   | Durable history is unaffected by this choice                     |
| Show an app-icon count       | Enable **Unread count on the app icon**                     | Requires the desktop shell and operating-system support          |

The command palette provides **Event Center**, **Mark all events read**, and **Clear event
history**.

## How it works

### What becomes an entry

| Runtime fact                                                                                   | Entry                             | Interrupts                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| Top-level run completed                                                                        | Success                           | No                               |
| Top-level run failed                                                                           | Error, with **Retry**             | Yes                              |
| Human input required                                                                           | Warning, with **Respond**         | Yes                              |
| A participant addressed you by name (`@user` in a group)                                       | Human input                       | Yes                              |
| Sub-agent or job session completed, failed or was stopped                                      | Success, error or information     | Only a failure                   |
| Background terminal exited                                                                     | Success for code zero, else error | Only a nonzero exit              |
| A problem the app or a plugin found (a file that will not validate, a connection that is down) | One standing entry per subject    | Only when nothing could be shown |
| An action you took that failed, or that needs a decision from you                              | Error or warning                  | Only an error                    |

Some facts are deliberately not entries: a slash command's reply, a shell you opened yourself
exiting, and every answer to your own action that is not a failure (a rename in the file tree, a
switched branch, a copied value, nothing to undo).

### Answers to your own actions

A success, a no-op or a refused input answers the click that caused it, so it is shown there: a
short line beside the control, about four seconds long, that stays while the pointer or keyboard
focus is on it and can carry one follow-up such as **Undo**. When the control is gone by then — a
menu that closed, a keyboard shortcut — the same line appears once on the right of the status bar.
Neither is kept, counted on the bell or the app icon, or sent as a desktop banner, and screen
readers announce it politely without interrupting.

### A failure you already see

When a form shows its own failure under the button you pressed, that is the report: the Event Center
does not add a second, generic entry for the same failed request. A failed request nothing else
reported still gets one entry, worded as what did not happen — "Could not save the MCP settings",
never the request's method and path.

### Standing problems

A problem is one entry for as long as it is true. Republishing it does not add rows; when it
changes, the new report replaces the old one; when it is fixed, the entry shows **Resolved**; and if
it comes back, the same entry reopens with a count. A lost connection works the same way: one entry
per outage source, settled when the connection returns, reopened with ×2, ×3 on the next drop.

### Connections and plugins that stop working

A provider connection that rate-limits you, runs out of its plan, or refuses its key is one standing
entry for that connection, whichever chat hit it; the next run that completes on it settles the
entry. A plugin set that fails to load for a workspace is one entry too, settled by the next load
that works. A question a participant asked you settles once you write in that conversation.

### Entries from plugins

An entry a plugin published is labelled with that plugin's display name and still opens the session
it happened in. A plugin backend's problem, such as a webhook URL that rejects every delivery, is a
standing entry per plugin and source.

### Actions on an entry

**Retry**, **Respond** and **Send to agent** stay available after a reload. A choice offered on a
failure or warning entry, such as **Force push** after a rejected push, stays available for one
minute: after that the state it would act on has moved on, and the button is gone. **Undo** after a
rename belongs to the answer beside the control, not to an entry.

### Where history lives

The journal is kept by the local server, under `~/.localix`, so an agent that finishes while every
window is closed is waiting in the bell when you come back, and reading or clearing an entry in one
window does it in all of them. A problem the app notices while the server is unreachable is shown at
once and delivered when the server is back.

### Retention

An entry that no longer needs anything from you leaves the journal 30 days after it was last seen,
and the journal never holds more than 5,000 entries; the bell shows the newest 200. When the journal
is full, the oldest settled entries go first; a request still waiting for you or a problem still
true is kept over newer noise. Replaying the same lifecycle event does not add a row or reset its
read state.

## Configuration

### Web and desktop

| Setting                           | Values                                  | Default              | Effect                                                        |
| --------------------------------- | --------------------------------------- | -------------------- | ------------------------------------------------------------- |
| **Notify me**                     | Always, When app is inactive, Never     | When app is inactive | Controls interruptive channels                                |
| **Waiting count on the app icon** | On or off                               | On                   | Counts chats waiting on you where the desktop badge API works |
| **Terminal compatibility**        | Automatic, OSC 9, OSC 777, Audible bell | Automatic            | Stores a web preference for terminal-signal delivery          |

### Terminal signals

Automatic terminal delivery requires a TTY, `TERM_PROGRAM=WarpTerminal`, and a non-empty
`WARP_CLIENT_VERSION`; it uses OSC 777. Other terminal emulators require an explicit OSC 9, OSC 777,
or BEL method.

## Limits

- A button that runs code in the window that showed it, such as **Undo** or a problem's **Open**,
  exists only in that window and is gone after a reload; the entry itself stays.
- The web and desktop app interrupt through native desktop banners only; there is no pop-up toast.
  The few-second answer to your own action is not an interruption and has no history: once it is
  gone, it is gone. Successful completions and ordinary warnings never interrupt, even when **Notify
  me** is **Always**.
- Desktop banners contain title and body only. Retry, Respond and source navigation stay in the
  Event Center.
- The app icon badge counts chats waiting on you (a blocked request, a plan, a mention — see
  [Cross-session attention](hitl.md#cross-session-attention)), not unread history, which stays on
  the bell. Windows has no numeric badge; the shell shows a red-dot overlay instead.
- Native delivery depends on operating-system permission. Automatic terminal detection recognizes
  Warp only.
- The routing contract accepts a quiet flag, but there is no user-facing quiet schedule or
  do-not-disturb control.

## Related guides

- [Human in the loop](hitl.md)
- [Delegation](delegation.md)
- [Your first session](../getting-started/first-session.md)

## Source of truth

- [Notification contracts](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/contracts.ts)
- [Event normalization](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/events.ts)
- [Channel policy](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/policy.ts)
- [Event Center](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/notification-center/NotificationCenter.tsx)
- [Server journal](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/notifications/journal.ts)
- [Window copy of the journal](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/journal.ts)
- [Interruption in the window](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/interruption.ts)
- [Notification preferences](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/prefs.ts)
- [Answers to your own actions](https://github.com/rsaryev/localix/blob/main/packages/kit/src/feedback/action-feedback.tsx)
- [Failure headlines](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/operationPhrases.ts)
