# Agent island

Localix's macOS island lives at the notch. It opens a quick chat, shows when agents are working and
brings their questions to you without switching windows. When nothing is happening it is invisible;
while an agent works, a light travels around the edge of the notch. It starts after the workspace is
ready and stays above ordinary windows, with no title bar or tabs.

## Open and fold

| To                  | Do this                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Preview             | Rest the pointer on the notch. The input takes focus immediately; Escape folds it.                        |
| Open and type       | Hover or click the notch, press **Cmd+Shift+J**, or choose **Quick Chat** from the Localix menu-bar icon. |
| Fold                | Click outside, switch to another app or press Escape.                                                     |
| Continue in the app | Choose **Open full conversation**.                                                                        |

While a Localix workspace window is focused, hovering or clicking the folded notch does nothing and
the click reaches the workspace below. **Cmd+Shift+J** and the menu-bar item still open the island.

A preview closes shortly after the pointer leaves unless you started typing or a request is open.
When the island folds, the keyboard returns to the app you were using. Another app may already own
the shortcut; the menu-bar item always works.

## Quick requests

Type and press Enter (Shift+Enter adds a line). Requests run as ordinary conversations with
Localix's default workspace and assistant, so they appear in the main app too. The island shows the
live reply with the same Markdown renderer as the main chat.

- **Stop generation** stops the task. Follow-ups stay in the same conversation, and one sent while
  the agent works joins the shared queue.
- **New session** starts fresh after the current run settles.
- Drag files onto the island to attach them.
- Your draft and the selected conversation are kept on the backend. Folding keeps both, and the main
  app sees the same draft. If both places edit it at once, the island asks which text to keep.

### Examples

| You type                                                        | What happens                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `Summarize what changed in the release branch today`            | A short reply streams in the island.                            |
| `Check the release checklist and tell me what is still missing` | The agent works; light flows around the notch until it settles. |
| A screenshot dropped on the island, then `What is this error?`  | The file is attached to the same request.                       |
| A follow-up while the agent is still working                    | It waits in the queue and runs next.                            |

When a reply needs files, history or settings, choose **Open full conversation**.

## Activity and decisions

At rest with nothing to report the island is hidden. While agents work, Localix's accent light flows
around the edge of the notch; when an answer is needed it turns warm and moves faster. Reduced
motion keeps it still.

- A new approval, question or secret request opens the island with its usual controls, and stays
  open when the pointer leaves.
- **Next request** steps through several waiting requests. **Open chat** opens the conversation that
  asked.
- Folding never answers, dismisses or snoozes a request. After you fold, the same request stays
  quiet until you hover or click.

The island is another view of the same request queue. The main app still delivers notifications, the
dock badge and the notification inbox.

## Scope

The island reads Localix conversations and the shared request queue. Work in an external CLI appears
only when it runs inside a Localix conversation or its interaction bridge; the island does not watch
other applications.

On macOS the island attaches to the physical top of the display and measures the notch, preferring a
display that has one. A display without a notch uses a small strip at the top center instead. When
displays change, for example when you close the lid or unplug a monitor, the island moves to the new
display. macOS 26 and later use Liquid Glass; earlier versions use the system popover material.
Light, dark and System appearance stay synchronized with the main window, including on a dark
desktop. The island folds and suspends while the Mac sleeps or the session is locked, then returns
quietly after wake or unlock.

The native island is available only on macOS. Windows and Linux do not create its window, register
its shortcut, or show its settings and Quick Chat menu item. The browser preview at `/#/companion`
shows the content without a global shortcut or native placement.

See [Human-in-the-loop](./hitl.md) for request behavior and [Background work](./background-work.md)
for how conversations run.

## Menu-bar icon

On macOS, click the Localix icon in the menu bar to open its menu: **Quick Chat**, **New Chat**,
your recent conversations, **Open Localix**, **Settings…** and **Quit Localix**. On Windows and
Linux, a left click opens Localix and a right click opens the app menu, without **Quick Chat**.

## Turn the island off

Open **Settings → Preferences → Agent island** and turn off **Show the agent island**. The island,
its shortcut and the **Quick Chat** menu-bar item disappear on this device until you turn it back
on.

The top row holds session history, New session and the working folder. History resumes a
conversation inside the island. Choosing a folder starts a new chat in that project; existing
conversations keep their original folder. Folder changes and New session are disabled while the
current agent runs.

The folded island keeps a faint, slow accent glow at rest, brightens during work and uses a warmer
edge when an answer is needed. Reduced Motion keeps the edge static.

The island uses the workspace composer with smaller action controls. Its context pills, tips and
model picker are hidden; choose the model in the workspace. The shared folder menu places Add folder
first in both surfaces.
