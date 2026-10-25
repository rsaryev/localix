# Manage notifications

The Event Center records agent runs, sub-agents and jobs, requests for your input, background
terminals, and problems the app, a mini app or a plugin found. Errors and requests for input can
also interrupt you on supported clients. History is retained by the server until it is cleared or
removed by retention; not every message the interface shows creates an entry.

The answer to something you just did — "Copied", "Nothing to undo", "Branch already exists" —
appears briefly beside the control and is not journaled. A form that already shows its failure does
not add a duplicate generic event.

## What you can do

| Action                      | Mechanism                                                   | Boundary                                                                 |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Review recent activity      | Open the title-bar bell; entries appear newest first        | The local server shares history with connected windows for the same user |
| See what runs right now     | **In progress** at the top of the Event Center              | Live status; it is not history and leaves when the job ends              |
| Apply an offered update     | **Update all** or **Restart to update** under **Updates**   | Mini app, plugin and Localix updates only                                |
| Read an entry in full       | Select the row; its body, actions and trace expand          | Expanding an entry marks it read                                         |
| Return to a source session  | Select the arrow on a row that names a session              | Application messages without a session are not navigable                 |
| Answer a waiting request    | Select **Respond** on a human-input entry                   | The entry settles once the request is answered, expires or ends          |
| Continue a failed run       | Select **Continue** on the failure entry                    | Gone once the conversation moved on; settled by a later run              |
| Hand a problem to the agent | Select **Send to agent** on a problem entry                 | Stages the report as context; review and send your own request           |
| Find an entry               | Search, or filter by status, event type, severity and time  | Search syntax is listed behind the **?** in the search field             |
| Manage unread state         | Expand an entry, open its chat, or select **Mark all read** | Opening the bell alone does not mark anything read                       |
| Remove history              | Remove one entry, or select **Clear history**               | Clear keeps pending requests and problems that are still true            |
| Control interruptions       | Choose **Always**, **When app is inactive**, or **Never**   | Durable history is unaffected by this choice                             |
| Show an app-icon count      | Enable the waiting count or indicator on the app icon       | Requires the desktop shell and operating-system support                  |

The command palette provides **Event Center**, **Mark all events read**, and **Clear event
history**.

## How it works

### In progress and updates

The top of the Event Center shows what Localix is doing in the background, live: the Store's
installs, updates and removals of mini apps and plugins, local model downloads and the download of a
Localix update. Each row has the package's icon, its name, what is happening ("Downloading · 3.0 MB
of 4.8 MB"), a progress bar and what can be done: pause, resume or cancel a model download, or open
the package in the Store.

Under **Updates** are the updates on offer: Localix's own, and the Store's packages of every kind
together, with **Update all**. While anything runs, the bell has a thin ring that fills as the jobs
do and its label says how many tasks are in progress; the unread count stays as it is.

These rows are not history. When a job ends, its owner records one entry: "Installed Git", "Updated
3 mini apps", or "Could not install Kanban" with the reason and **Try again**, which queues the app
again and is settled once it installs.

### What becomes an entry

| Runtime fact                                                                                               | Entry                                                                                           | Interrupts                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| Top-level run completed                                                                                    | Success                                                                                         | No                               |
| Top-level run failed                                                                                       | Error with applicable recovery                                                                  | Yes                              |
| Human input required                                                                                       | Warning, with **Respond**                                                                       | Yes                              |
| A board card was assigned to you (`@human`)                                                                | Human input                                                                                     | Yes                              |
| Sub-agent or job session completed, failed or was stopped                                                  | Success, error or information                                                                   | Only a failure                   |
| Background terminal exited                                                                                 | Success for code zero; information for a stop or a stop signal (129, 130, 137, 143); else error | Only an unexpected nonzero exit  |
| A problem the app, a mini app or a plugin found (a file that will not validate, a connection that is down) | One standing entry per subject                                                                  | Only when nothing could be shown |
| An action you took that failed, or that needs a decision from you                                          | Error or warning                                                                                | Only an error                    |
| Mini apps installed or updated, or an install that failed                                                  | Success, or error with **Try again**                                                            | Only a failure                   |

A logical run reports once after retries and continuations finish. Successful top-level runs report
when no later turns remain queued; nested chats do not add the same completion entry. **Continue**
appears only when the failure's recovery supports it; it picks the reply up where it stopped, as the
row above the composer does
([A reply that did not finish](conversations.md#a-reply-that-did-not-finish)). Authentication and
rate-limit failures owned by a provider connection update its standing problem instead of adding a
duplicate run-failure entry.

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

### Connections, mini apps and plugins that stop working

A provider connection that rate-limits you, runs out of its plan, or refuses its key is one standing
entry for that connection, whichever chat hit it; the next run that completes on it settles the
entry. A set of mini apps that fails to load for a workspace is one entry too, settled by the next
load that works; its **Open mini apps** action opens Settings → Capabilities → Mini apps. A plugin
that fails to load is its own entry, which opens Settings → Capabilities → Plugins. A question a
participant asked you settles once you write in that conversation.

### Entries from mini apps

An entry a mini app published is labelled with that mini app's display name and still opens the
session it happened in. A mini app backend's problem, such as a webhook URL that rejects every
delivery, is a standing entry per mini app and source, and its **Open mini app settings** action
opens that app's row in Settings → Capabilities → Mini apps.

### Actions on an entry

**Continue**, **Respond** and **Send to agent** stay available after a reload. A choice offered on a
failure or warning entry, such as **Force push** after a rejected push, stays available for one
minute: after that the state it would act on has moved on, and the button is gone. **Undo** after a
rename belongs to the answer beside the control, not to an entry.

### Ask an agent about a problem

Open the problem's source conversation, then select **Send to agent**. For an application-wide
problem, open the conversation you want to use first. The button attaches the headline and report
body, including any fix hints, as context in that conversation's composer. It does not send a
message or start a run.

Check that the context appeared, add what you want the agent to do, and send the message. The button
does not open a missing source composer or save the attachment for a later opening. An
application-wide problem with no open conversation asks you to open one first.

### Where history lives

The journal lives in the server’s configured SQLite database, normally under `~/.localix`;
`LOCALIX_DB_FILE` can change that location. While the server keeps running, an agent can finish
without a window connected and its event is available when you return. Reading or clearing an entry
propagates to connected windows for the same user.

A client-originated problem can appear locally while the server is unreachable. The client buffers
up to 1,000 unacknowledged journal operations and attempts to replay them when the server returns.
Oldest operations are dropped beyond that cap. Reload recovery uses browser local storage and is
best-effort; this buffer is not an unlimited delivery guarantee. Connected clients retry failed
delivery with backoff from two seconds up to one minute. Invalid batches are dropped. The server
retains operation IDs for seven days; replay after those receipts are pruned may apply an old
operation again.

Reconnecting retrieves the current journal state, not every historical transition. If the saved
cursor predates retained events, the client reloads the current inbox; a server cursor behind the
client's triggers a reload from zero. Catch-up rows update history without interrupting you. Native
banners are considered for eligible live entries or this window's newly acknowledged events.

### Retention

Entries that no longer need action become eligible for removal 30 days after their last occurrence.
Cleanup runs about one minute after server startup and then daily. It also trims each user’s journal
to 5,000 entries: oldest non-pending entries go first, followed by oldest pending entries if
necessary. Waiting requests and unresolved problems get priority, not permanent protection from that
cap.

The bell’s client projection holds at most 200 entries and preferentially keeps pending work. It is
not always the newest 200 rows or a complete view of server history. Replaying the same lifecycle
event does not add a row or reset its read state.

## Configuration

### Web and desktop

| Setting                           | Values                                  | Default              | Effect                                                        |
| --------------------------------- | --------------------------------------- | -------------------- | ------------------------------------------------------------- |
| **Notify me**                     | Always, When app is inactive, Never     | When app is inactive | Controls interruptive channels                                |
| **Waiting count on the app icon** | On or off                               | On                   | Counts chats waiting on you where the desktop badge API works |
| **Terminal compatibility**        | Automatic, OSC 9, OSC 777, Audible bell | Automatic            | Stores a preference; current UI emits no terminal signals     |

Notification preferences use browser local storage for the current app/profile. They are separate
from the shared server journal and can differ between clients.

### Terminal compatibility

The advanced setting stores a terminal-protocol preference. The current web/desktop notification
path only delivers native banners; changing this setting does not make it emit terminal signals.

The shared notification package provides OSC 9, OSC 777 and BEL adapters for hosts that connect
them. Its automatic detection requires a TTY, `TERM_PROGRAM=WarpTerminal`, and a non-empty
`WARP_CLIENT_VERSION`, and selects OSC 777. Other terminal emulators require an explicit method.

## Limits

- A button that runs code in the window that showed it, such as **Undo** or a problem's **Open**,
  exists only in that window and is gone after a reload; the entry itself stays.
- Browser-only clients keep the Event Center without native desktop banners. The desktop shell
  delivers native banners when the OS permits them; the web/desktop notification path has no pop-up
  toast. Brief control feedback has no journal history. Successful completions and ordinary warnings
  do not interrupt, even with **Notify me → Always**.
- Interruption is age-limited independently of history: run events have a ten-minute window, waiting
  requests and standing conditions a one-hour window. An older event can remain in the journal
  without producing a banner. Catch-up history does not interrupt even when recent. **Always**
  changes focus policy, not this age limit.
- Desktop banners contain title and body only. Retry, Respond and source navigation stay in the
  Event Center.
- The app icon badge counts chats waiting on you (a blocked request, a plan, a mention — see
  [Cross-session attention](hitl.md#cross-session-attention)), not unread history, which stays on
  the bell. Windows has no numeric badge; the shell shows a red-dot overlay instead.
- Native delivery depends on operating-system permission. The shared terminal adapter's automatic
  detection recognizes Warp only.
- The routing contract accepts a quiet flag, but there is no user-facing quiet schedule or
  do-not-disturb control.

## Related guides

- [Human in the loop](hitl.md)
- [Forks](delegation.md)
- [Your first session](../getting-started/first-session.md)

## Source of truth

- [Notification contracts](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/contracts.ts)
- [Event normalization](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/events.ts)
- [Channel policy](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/policy.ts)
- [Event Center](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/notification-center/NotificationCenter.tsx)
- [Client journal delivery](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/journalDelivery.ts)
- [Logical run reporting](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/notifications/producers/runs.ts)
- [Retention priority and caps](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/notifications/retention.ts)
- [Cleanup schedule](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/ops-timers.ts)
- [Client projection cap](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/core.ts)
- [Offline operation buffer](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/outbox.ts)
- [Server journal](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/notifications/journal.ts)
- [Window copy of the journal](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/journal.ts)
- [Interruption in the window](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/interruption.ts)
- [Notification preferences](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/prefs.ts)
- [Answers to your own actions](https://github.com/rsaryev/localix/blob/main/packages/kit/src/feedback/action-feedback.tsx)
- [Failure headlines](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/operationPhrases.ts)
- [Problem context handoff](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/notifications/agentHandoff.ts)
- [Composer context delivery](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/composerBus.ts)
- [Terminal adapters](https://github.com/rsaryev/localix/blob/main/packages/notifications/src/terminal.ts)
