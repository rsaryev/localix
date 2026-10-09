---
name: create-motion
description:
  Create and revise motion videos in Motion Studio with editable templates, scene timing, images,
  audio and keyframed layers.
---

# Create a motion video

Use `motion_studio` for projects shared with the user's Motion Studio editor. Read `guide` once for
the current schema, templates, primitive layouts and motion-preset examples. Files live in the
current workspace under `.localix/motion/`, matching the Resumes workflow. Use ordinary
source-reading tools for provided copy, product evidence and brand material.

1. Clarify audience, platform, message and intended action only when they cannot be inferred.
   Capture these in the project's creative brief. Choose landscape, portrait or square deliberately.
2. Plan a coherent film: hook → reveal → evidence → end card. One idea per scene. Provide actual
   copy, not editing instructions. Favor 2–6 seconds per beat and enough hold time to read.
3. Choose a starting template: product launch, kinetic typography, social campaign, explainer, data
   story, brand reveal, event poster or editorial film. For a dark film, Blackout is a typographic
   hook, Relay a product story and Nightfall a measured brand signature. `create` accepts a complete
   document, so author custom content in one call where practical. The returned ID, revision and
   resource URI are authoritative.
4. Use built-in layouts for composition, plus keyframed text, rectangle, circle image, ring,
   rosette, orbit, line, grid and aperture-frame layers for distinctive sequences. Hook, Focus and
   Wordmark layouts support masked dark type, a reveal and a readable lockup. `custom` draws only
   layers. Positions and sizes are normalized to the frame; font size uses the shorter edge.
   Keyframe times are local to a scene. Use complete transforms, ordered times and unique UUIDs.
   Stagger related elements, avoid gratuitous motion, and leave a readable final pose. Preview and
   export are deterministic at the chosen frame rate.
5. List existing media before referencing it. The user uploads images and MP3/WAV/Ogg audio in the
   editor; arbitrary URLs and filesystem paths are not media IDs. Do not invent screenshots, logos,
   quotes, statistics or evidence. Mark illustrative drafts honestly.
6. Open the resource in Motion Studio for review. Check all scenes, transitions, safe margins, text
   fit, pacing and audio. A structured project is not a rendered MP4: the user exports from the
   workbench, with MP4/WebM codec support depending on their browser.
7. Before revising, `get` the current revision. Update the complete document while preserving fields
   outside the requested change. On conflict, read again and reconcile; never retry the old document
   against a new revision without checking intervening edits. `duplicate` keeps independent
   variants. Unsaved visible context is evidence, not saved state.

See [references/quality.md](references/quality.md) for pacing and the source reference collection.
