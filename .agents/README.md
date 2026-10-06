# Project skills

These project-scoped skills support design, planning and implementation. UI skills supplement the
Localix UI kit skill at `.claude/skills/localix-ui-kit/SKILL.md`.

Read `AGENTS.md` and `docs/internals/visual-system.md` before changing Localix UI. Use existing kit
controls, semantic tokens and shared overlay motion. Generic examples do not authorize replacing the
design system, adding a second component library or installing dependencies. Apply a skill only when
it helps the requested task; do not load all skills for every UI change.

| Skill                        | Use                                                        | Source                                                                             |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| frontend-design              | Visual direction and frontend composition                  | [Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design) |
| ui-ux-pro-max                | Searchable UI/UX, typography and design references         | [Next Level Builder](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)      |
| impeccable                   | UI critique, audit, layout, typography and polish          | [Paul Bakaus](https://github.com/pbakaus/impeccable)                               |
| hallmark                     | New visual directions, redesign and reference analysis     | [Nutlope](https://github.com/Nutlope/hallmark)                                     |
| motion-design                | Animation timing, choreography and interaction feedback    | [LottieFiles](https://github.com/LottieFiles/motion-design-skill)                  |
| shadcn-ui                    | Accessible component patterns, adapted to the existing kit | Existing ai-gateway project skill                                                  |
| tailwindcss-advanced-layouts | Grid, Flexbox and responsive layout references             | Existing ai-gateway project skill                                                  |

The GitHub skills include their reference files and scripts. The last two were copied with their
supporting files from the existing ai-gateway installation. Installing a skill does not install or
execute its external tools; review its requirements when using that tool.

## Planning and discovery

| Skill           | Use                                                                        | Source                                                                                                  |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| domain-modeling | Resolve domain terminology and record architectural trade-offs             | [Matt Pocock](https://github.com/mattpocock/skills/tree/main/skills/engineering/domain-modeling)        |
| grilling        | Stress-test a plan through a focused design interview                      | [Matt Pocock](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling)              |
| grill-with-docs | Combine the interview with glossary and ADR updates                        | [Matt Pocock](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs)        |
| motion-ui       | UI motion patterns, accessibility, performance and implementation examples | [Everything Claude Code](https://github.com/affaan-m/everything-claude-code/tree/main/skills/motion-ui) |
| find-skills     | Discover and evaluate skills against existing project capabilities         | [Vercel Labs](https://github.com/vercel-labs/skills/tree/main/skills/find-skills)                       |

These five skills are complete, unmodified copies from a reference project's installed skills,
including their supporting files. Repository guidelines and the Localix UI kit contract still take
priority when using them. No bundled tools were installed or executed.
