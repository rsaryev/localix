# Motion source research

Inspected with GitHub repository search and repository contents on 2026-10-09. Star counts alone do
not establish motion quality: these references were selected for inspectable source, playable
examples, breadth of scenes or a useful authoring workflow. No external source or media is copied
into this plugin.

| Reference                                                                                                                   | Inspect                                                                                                 | Use                                                                                        | License evidence                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [NullMotion](https://github.com/blixvip/NullMotion/tree/d8b6e0e7390f5a5849707288e6a8d89007982f3e)                           | `public/drafts.mjs`, showcase and third-party notices                                                   | A finished film synchronized with its draft scenes; storyboard timing and breakdown export | GitHub reported no repository license. Bundled reference films are other creators' work. Do not redistribute them without separate rights. |
| [RenderComp templates](https://github.com/RenderComp/free-remotion-templates/tree/f648980e528defb7594e24c6447055f0540f340b) | `src/components/kinetic-word-stack`, `social-reel`, `logo-mask-wipe`, `bar-chart-anim`, `end-card`      | 50 single-component templates; finished defaults and explicit props                        | MIT template source with SPDX headers; Remotion has separate terms. Assets added by a user have their own terms.                           |
| [Remotion scenes](https://github.com/lifeprompt-team/remotion-scenes/tree/02c7a84241da7010b5f59c420b0110aafd1d6f0d)         | `src/scenes/TextAnimations`, `UIAnimations`, `DataAnimations`, `LogoAnimations`, `TransitionAnimations` | 201+ scenes and shared timing utilities; useful breadth for an agent's vocabulary          | Repository license is MIT. Inspect individual assets before copying them.                                                                  |
| [Remotion trailer](https://github.com/remotion-dev/trailer)                                                                 | Scene source and the linked finished trailer                                                            | Continuity, pacing and product-video choreography                                          | GitHub did not report a license during this research; inspiration only.                                                                    |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas)                                                             | `packages/examples` and [quickstart](https://motioncanvas.io/docs/quickstart)                           | An alternative animation model with explicit timeline sequencing                           | Verify package and asset licenses before reuse.                                                                                            |

## Engine choice

Localix uses original canvas compositions driven by a frame number. UI preview, seeking and export
call the same renderer. The agent edits validated scene data and complete layer transforms rather
than executing generated scripts inside the workbench. This fits the existing Bun plugin model,
avoids a second React runtime and requires no local FFmpeg or headless browser for user export.

[Mediabunny](https://mediabunny.dev/guide/quick-start) 1.61.3 supplies WebCodecs encoding and
MP4/WebM muxing, loaded only for export. It is MPL-2.0 and remains an unmodified dependency;
distribution notices are collected by the repository's runtime notice staging. The plugin kit
retains the package's browser exclusions so relocated installed plugins cannot pull in Node
filesystem APIs.

The tradeoff is intentional and visible: local encoding depends on the browser's video and audio
codecs. The agent authors a project; video files are produced by the workbench's Export action.

## Editor and agent-authoring references

The second pass used GitHub search for motion-graphics editors, template source and agent skills,
then inspected these specific sources. The official
[Remotion skill listing](https://skills.sh/remotion-dev/skills/remotion-best-practices) was present
on the skills.sh leaderboard on 2026-10-09; download popularity was supporting evidence, not the
selection criterion. No external skill is silently installed or made a runtime dependency.

- [Remotion Agent Skills](https://github.com/remotion-dev/skills/tree/32b241b97f4e0e4ab61fe9a41b05e6e64503f8c5):
  read the official `remotion-best-practices/SKILL.md`. It separates authoring, interactive review,
  rendering and preservation of user edits. GitHub reported no repository-wide license in this
  inspection; link to it rather than redistribute it.
- [HyperFrames](https://github.com/heygen-com/hyperframes/tree/46f6cb356785bed79e1ce7b79d7e7accc697786a):
  read creative motion principles, story-spine and bold-poster frame guidance, plus the `orbit-card`
  block contract and frame-sampled motion source. Useful for different rhythm, hold/resolve phases,
  purposeful connectors, editable parameters and seek-safe primitives. Repository license is
  Apache-2.0; blocks include their own font and third-party notices. Nothing is copied locally.
- [Motionity](https://github.com/alyssaxuu/motionity): inspected the editor feature inventory and
  preview reference. Canvas, properties and timing are distinct jobs; a layer is an editable object.
  It is a UI reference, not a bundled engine.
- [Jitter's interface tour](https://help.jitter.video/en/articles/12597029-a-quick-tour-of-the-interface)
  and [template gallery](https://jitter.video/templates/): the canvas leads, properties follow the
  selection, and a template can be reviewed before creating a draft. The Localix shell and kit
  remain the visual authority.

The implemented motion vocabulary is original: clipped poster type, diagonal ribbons, geometric
orbits, serif editorial frames, connected steps and editable bar charts. Reusable ring, rosette,
orbital mark and line layers combine with complete Pop, Glide, Pulse and Turn keyframe recipes.

## Dark hook and cinematic studies

The user supplied NullMotion's Infinite hook as a visual reference. The inspected reference at
`d8b6e0e7390f5a5849707288e6a8d89007982f3e` uses a small opening phrase followed by a large
typographic hit, a quiet coordinate grid, then a reveal and product sequence. Inspected its first
two reference frames, section timings and beat descriptions in `showcase/references/drafts.json`.

Also inspected
[HyperFrames Motion Director](https://github.com/geekjourneyx/hyperframes-motion-director/tree/0b66750322ccb50ae56ace5a8d361da2c1f65400),
specifically `references/motion-craft.md` and `references/visual-standard.md`: entry, readable hold,
visual handoff, and one leading idea per beat. That repository is AGPL-3.0; it is a linked authoring
reference, with no copied instructions, implementation or media.

Blackout, Relay and Nightfall are original frame-sampled studies of this direction. Hook uses a
measured stage and clipped type with a short scale settle. Focus reveals an aperture or editable
product flow. Wordmark resolves into a quiet lockup. Grid and aperture-frame layers are reusable
validated primitives. All dark film colors remain content palettes, independent of host chrome.
