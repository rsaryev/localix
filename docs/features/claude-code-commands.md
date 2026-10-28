# Claude Code commands in Localix

Which built-in Claude Code slash commands Localix runs, what they do here, and what the ones it
cannot run answer instead.

## Everyday Claude Code commands

The commands Claude Code users reach for run in Localix as thin wrappers: each calls what the app
already does, so it behaves as the button or menu would. Those marked client run in the composer and
need web or desktop; any other surface answers that a compatible client must handle them.

| Command                                   | What it does                                                                                              | Crumbs                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `/clear` (client)                         | Starts a new chat in this project, as **New chat** does.                                                  | None                                                       |
| `/resume [chat]` (client)                 | Opens a recent chat; with none, opens the chat picker.                                                    | Recent chats, newest first                                 |
| `/rename <title>` (client)                | Retitles this chat, as renaming in the sidebar does. Without a title it shows its usage.                  | The title, as text                                         |
| `/rewind` (client)                        | Rolls this chat back to one of your messages after the same question the message menu asks.               | Your messages, newest first                                |
| `/plan [task]` (client)                   | Switches this chat to Plan mode, then sends the task when you gave one.                                   | The task, as text                                          |
| `/context` (client)                       | Shows how full the context window is, from the numbers the usage indicator uses.                          | None                                                       |
| `/copy [n]` (client)                      | Copies the nth latest reply, as **Copy text** on that message does; `1`, the latest, by default.          | Replies, newest first                                      |
| `/permissions`, `/config` (client)        | Open Settings at Permissions, or at Preferences.                                                          | None                                                       |
| `/effort` (client)                        | Sets an agent's reasoning level on the model it already runs: `/model`'s steps from the level on.         | The agent (groups only), then the levels that model offers |
| `/compact [instructions]`                 | Asks for a [context checkpoint](context-checkpoints.md) on the next message, for every agent of the chat. | The instructions, as text                                  |
| `/init`                                   | Has the agent write a `CLAUDE.md` for the project, or improve the one it has, as a normal turn.           | None                                                       |
| `/status`                                 | Shows the chat, its folder, permission mode, agents with their models, added folders and plugins.         | None                                                       |
| `/hooks`                                  | Lists the hooks of the folder's settings files and enabled plugins, by event and source.                  | None                                                       |
| `/diff`                                   | Shows `git status` and the patch against the last commit for the chat's folder, cut at 16,000 characters. | None                                                       |
| `/add-dir <path>`                         | Adds a folder the agent may work in, written to `.claude/settings.local.json`.                            | The path, as text                                          |
| `/export [filename]`                      | Writes the conversation as Markdown to the file, or to `exports` under the Localix home.                  | The file name, as text                                     |
| `/reload-plugins`, `/reload-skills`       | Run `/plugin reload`, which reloads plugins and their skills. Not listed in the menu.                     | None                                                       |
| `/help [command]`                         | Lists the commands, or describes one.                                                                     | Command names                                              |
| `/output-style [style]`, `/memory [fact]` | As before; the style is offered from the styles this chat can pick, the fact is typed as text.            | Styles, or text                                            |

### What the newer commands do

- **`/compact`** is a checkpoint, not a summary written by a model. Every agent of the chat takes
  one on its next turn whatever the measured size; a conversation already below the target is left
  whole, and the transcript keeps everything. Claude Code's `PreCompact` and `PostCompact` hooks
  hear it as trigger `manual`, and `PreCompact` receives your text as `custom_instructions`. The
  text cannot steer the cards, which are written without a model.
- **`/init`** sends the agent an instruction to read the README, manifests, CI and existing
  instruction files and write `CLAUDE.md`; where `AGENTS.md` exists it imports it with `@AGENTS.md`
  instead of copying it. The agent's `Write` and `Edit` ask for approval as usual.
- **`/add-dir`** checks that the path is a folder, then adds it to
  `permissions.additionalDirectories` in the folder's `.claude/settings.local.json`. Claude Code
  reads the same file, and it applies to this folder's later chats too. A file that is not valid
  JSON is left alone. The agent may use the folder from the next message.
- **`/export`** never replaces a file. With a name, it is relative to the chat's folder and gets
  `.md` when it has no extension.
- **`/diff`** runs `git` in the chat's folder; untracked files are listed, not shown. It is a reply
  in the chat, not a diff view.

`/init`, `/status`, `/hooks`, `/diff`, `/add-dir`, `/export` and `/compact` are reserved names: a
plugin command or skill of the same name no longer runs.

### Claude Code commands Localix cannot run

A Claude Code command that has no counterpart is answered with why, and with what to use instead
where Localix has something, rather than as an unknown command. These names are not reserved: a
skill, a plugin command or a mod command called `/review` or `/debug` still runs, and the answer
appears only when nothing claims the name.

| Command                                                                                                      | Answer                                                            |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `/branch`, `/checkpoint`, `/undo`                                                                            | Points to `/fork` or `/rewind`.                                   |
| `/autocompact`                                                                                               | Points to **Model details → Context limit**.                      |
| `/login`, `/logout`, `/upgrade`, `/usage-credits`, `/privacy-settings`, `/passes`                            | Localix connects to model providers; it has no Anthropic account. |
| `/terminal-setup`, `/tui`, `/vim`, `/keybindings`, `/scroll-speed`, `/focus`, `/color`                       | Terminal-only; shortcuts are in **Settings → Shortcuts**.         |
| `/desktop`, `/mobile`, `/teleport`, `/remote-control`, `/schedule`, `/background`, `/ultrareview`            | Claude Code cloud features; `/loop` repeats a task here.          |
| `/ide`, `/chrome`, `/sandbox`, `/statusline`, `/voice`, `/tasks`, `/bashes`, `/exit`, `/quit`                | A one-line reason or the place to look.                           |
| `/review`, `/code-review`, `/security-review`, `/simplify`, `/batch`, `/debug`, `/doctor`, `/run`, `/verify` | Bundled Claude Code skills: install a plugin that provides one.   |

## Related guides

- [Use hooks and slash commands](hooks-and-commands.md)
- [Claude Code compatibility](../extending/claude-code-compatibility.md)

## Source of truth

- [Core slash-command catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/slash-catalog.ts)
