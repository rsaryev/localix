---
name: Motion Studio
description: A film viewer and direction gallery that inherits the Localix workbench visual system.
---

# Design: Motion Studio

The workbench chrome follows the [Localix visual system](../../docs/internals/visual-system.md) and
the [UI kit contract](../../.claude/skills/localix-ui-kit/SKILL.md). Film content is not workbench
UI: its palette and type come from the film's direction tokens (`blocks/style.css`), never from the
workbench theme.

- **Library:** `WorkbenchListRow`s (title; direction · format · scenes · last render; duration or
  job progress). Empty: one `IconButton size="touch"` **+** centred in an `EmptyHint`.
- **Directions:** `SelectionTile` grid (1–5 columns by container width), a 16:9 still box with the
  film's poster frame (portrait films centred), name, category, aspect. Hover plays the film muted
  in place after a short intent delay.
- **Direction preview:** toolbar with **Back to directions**, the name and a ghost **Use
  direction**; the description, then the film large and centred with the player's transport.
- **Film:** toolbar with back, title and meta, **Render** menu and overflow; job progress bar; the
  player is the hero; issues, renders and review stills are quiet collapsible sections.
