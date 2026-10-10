---
name: create-motion
description:
  Make motion films — launch and landing videos, product demos with screenshots, kinetic type, logo
  reveals — as HyperFrames code (HTML/CSS/GSAP) in Motion Studio. Fork a direction (a complete
  sample film), edit files with the normal tools, review PNG snapshots, render MP4 on request.
---

# Make a motion film

A film is a [HyperFrames](https://hyperframes.heygen.com) project in the conversation workspace,
`.localix/motion/<id>/`. You write it as code. `motion_studio` forks it from a direction, imports
media, checks it, snapshots stills and renders video. Motion Studio shows the person a live preview
of the same files while you work.

A **direction** is a complete, hand-made sample film with its own idea, layout grammar, motion
signature and transitions (Blackout, Relay, Nightfall, Orbit, Type play, Daylight, Connect,
Momentum, Soft signal, Offbeat, Field notes — `guide` describes each). Forking keeps its
choreography and replaces the story; `restyle` applies only its look and rules to a film you
structure yourself. The person may already have started a film with **Use direction** in Motion
Studio: then `list` shows it and you rewrite that one instead of creating another.

If HyperFrames skills are available (`/hyperframes`, `/hyperframes-core`, `/hyperframes-animation`,
`/hyperframes-registry`), load them for the composition contract and the block catalog; this skill
adds the Localix workflow and quality bar.

## Workflow

1. **Brief.** Infer audience, platform, message and call to action from the request and the
   workspace (landing copy, README, docs, brand files). Ask only for what you cannot find. Write
   `BRIEF.md` and `STORYBOARD.md` in the project. Never invent claims, quotes, statistics or
   features; label illustrative data on screen as an example.
2. **Fork.** `motion_studio create` with a title, the direction that fits the brief (or the one the
   person picked) and, if needed, a format (landscape for a landing hero, portrait for social). Read
   `AGENTS.md` (contract, blocks, craft), `DIRECTION.md` (the rules to follow) and the scene files
   before editing. Sample lines carry `data-sample` until you replace them.
3. **Media.** Find the real logo, screenshots, video and music, then `motion_studio import` them
   (several per call). Reference them as `assets/<file>`. Prefer real product screenshots inside
   `mk-browser` over HTML mock-ups.
4. **Build.** Rewrite scenes one at a time with small edits; add or remove scene files and slots in
   `index.html` as the storyboard needs. Use the `MK.*` helpers and `mk-*` classes; write your own
   GSAP where a block does not fit. Retime with the slots and transitions in `index.html`.
5. **Check.** `motion_studio check` after each round; `deep: true` before snapshots for layout,
   contrast and runtime errors. Fix every finding, including leftover sample copy.
6. **Look.** `motion_studio snapshot` with `at` set to each scene's midpoint and end, then open the
   PNGs (start with `contact-sheet.jpg`). Judge them like a motion designer: text fit and margins,
   one clear focal point, hierarchy, contrast, nothing clipped, empty or stuck, the end card
   readable. Fix and snapshot again until every frame is right.
7. **Hand over.** Summarise the storyboard and timings and link the film resource. The person
   previews and renders in Motion Studio. Call `render` only when they ask for the file; a project
   is not an MP4.

When revising, read the current files first: the person may have changed them. Keep IDs, timeline
keys and timing consistent across `index.html` and the scene files.

See [references/craft.md](references/craft.md) for timing, type, motion and composition numbers.
