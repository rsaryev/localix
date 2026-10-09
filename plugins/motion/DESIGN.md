---
name: Motion Studio
description: A motion video editor that inherits the Localix workbench visual system.
---

# Design System: Motion Studio

## Overview

Motion Studio extends the existing Localix Operate world. The visual authority remains the
[Localix visual system](../../docs/internals/visual-system.md) and
[UI kit contract](../../.claude/skills/localix-ui-kit/SKILL.md). This file records the extension's
implemented composition; it introduces no independent theme, token scale or component system.

The interface stays compact and quiet around the video. The main library shows saved projects and a
plus action, centered when the library is empty. Creation opens a separate page inside the pane;
rendered frames and playback let the user inspect a direction before creating a project.

## Colors

Chrome uses host foreground, strong/soft/faint text, border, field-fill and state tokens. The pane
inherits its ground. Errors and revision conflicts use host error and warning tones.

**The Content Palette Rule.** Film palettes belong to the authored video. Their ink, paper, cobalt,
citrus, rose, ember, electric, noir and graphite colors remain inside rendered frames, independently
of the workbench theme. Scenes can inherit the video palette or choose their own. The palettes are
defined in [graphics.ts](shared/graphics.ts), not as new UI tokens.

## Typography

Chrome inherits the host UI font and root preference. The page title and scene settings heading use
the small tier with medium weight, controls and descriptions use the extra-small tier, and metadata
and timing use the double-extra-small tier. At the default root these correspond to 13, 12 and 11px;
the shared rem scale follows user preferences. The creation page heading follows the same small
title tier; confirmation dialogs retain the kit's hierarchy.

Timing metadata uses tabular numbers. Scene tile headlines truncate; template tiles show their name,
category and duration, with descriptions in the playback view. Film lettering is rendered document
content and does not define a chrome display style.

## Layout

The pane fills its available width, with shared gutters and a scrolling body. Header and action rows
wrap. Saved project rows occupy the main library; an available media library stays collapsed beneath
them. The creation page keeps navigation and actions in a wrapping toolbar above its scrolling body.
Its gallery grows from one to two to three to four columns at the host large, double-extra-large and
five-extra-large container steps. The named `motion-creation` container scopes those changes to the
available pane width. Each gallery preview occupies a landscape slot; portrait film retains its
portrait proportions inside it. A selected template replaces the gallery with its description and
playback in the same page.

The editor places title/save state and document choices above the video. Preview, transport, scene
selection, scene actions and export form the primary column. At the existing `@5xl` container step,
scene fields occupy an 18rem right column separated by a seam. Below that step the fields follow
export and precede the collapsed Audio & creative brief section. The scene strip scrolls
horizontally.

## Elevation & Depth

The workbench ground remains transparent. Borders, host field veils and shared hover/selection
states provide structure. Menus and confirmation dialogs receive their material and motion from the
kit; the plugin supplies no private overlay shadows or motion recipes.

## Shapes

Fields, buttons, tiles and film clipping use the existing host radius scale. Actions use the small
control rung; compact row actions use the extra-small rung. Form fields retain their kit defaults.

## Components

- **Actions:** ordinary buttons inherit the shared plain, borderless resting style and host hover,
  press and focus states. Creating a video uses a plus `IconButton` with an accessible name and
  tooltip; it sits in the toolbar when projects exist and at the center of an empty library.
- **Saved projects:** shared `WorkbenchListRow` with title, category, scene count, duration and
  duplicate/delete actions. Deletion uses the shared confirmation dialog.
- **Creation chooser:** [CreateVideoView](ui/CreateVideoView.tsx) uses shared `SelectionTile` with
  eleven rendered directions: Blackout, Relay, Nightfall, Orbit, Type play, Daylight, Connect,
  Momentum, Soft signal, Offbeat and Field notes. Tiles show names, categories and durations.
  **Projects** returns to the library. Choosing a tile opens its description and playable preview;
  **Back to templates** or Escape returns from preview or import to the chooser, preserving the
  category, selected tile, scroll position and keyboard focus. Plain toolbar actions expose **Import
  JSON**, **Start from scratch** and, in a preview, **Use template**. Browsing creates no project;
  successful template creation, blank creation or import opens the saved project in the editor. Busy
  actions and backward navigation are disabled while a write is pending. Preview frames come from
  the same renderer as playback and export.
- **Dark film compositions:** Blackout provides monochrome typographic hooks, Relay pairs hooks with
  a framed product flow, and Nightfall uses warm graphite, apertures and brand lockups. The Hook,
  Focus and Wordmark layouts use frame-driven text masks, grids, apertures and product-flow reveals.
  These original content compositions remain editable through scene fields; reusable grid and frame
  layers also support keyframes. They introduce no new workbench materials or tokens.
- **Document and scene choices:** quiet shared menu triggers and selected `MenuEntries` rows for
  format, palette, frame rate, layout and transition.
- **Scene selection:** shared selection tiles with actual scene thumbnails, numbered timing metadata
  and an active outline. Selecting a scene seeks the preview into it; playback and seeking update
  the selected scene and its inspector together.
- **Scene fields:** kit fields, inputs and textareas, with layout-specific controls for editable
  content, including bar labels and values. Scene palette choices inherit or override the video
  default. Advanced motion starts collapsed except for a custom layout, where it opens to the
  editable layers and keyframes. The nested Layer JSON disclosure starts collapsed regardless of
  existing layers. Audio & creative brief also starts collapsed.
- **Playback and export:** labeled kit transport actions, playhead and timing; export controls
  follow the scene actions. Busy, saved, unsaved and conflict states remain explicit.

## Do's and Don'ts

- **Do** reuse host primitives, tokens, control sizes and focus behavior.
- **Do** keep film color and composition in the document renderer, separate from chrome.
- **Do** retain preview and transport before detailed editing in the narrow reading order.
- **Do** keep revision and unsaved state visible while the user and agent share a project.
- **Don't** paint a second pane ground or create plugin-specific theme tokens.
- **Don't** turn a template's film lettering, imagery or palette into workbench styling.
- **Don't** replace rendered template previews with generic decorative placeholders.
