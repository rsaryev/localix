# External agent marks — attribution

Five of the six glyphs exported by `index.tsx` come from a published, MIT-licensed set. Claude and
Codex now live in the shared kit's `coding-agent-marks` module and are re-exported here; the other
marks remain local to this plugin. Their path data is preserved verbatim.

## Provenance chain

1. **Upstream:** [`steipete/CodexBar`](https://github.com/steipete/CodexBar) —
   `Sources/CodexBar/Resources/ProviderIcon-*.svg`, MIT.
2. **Intermediate:** [`openclaw`](https://github.com/openclaw/openclaw) copied the set one-for-one
   into `ui/public/provider-icons/` at CodexBar commit `215efbd39ad58acb4b0cd637c407d63e6183bc8d`,
   stripping XML declarations and generator metadata, and shipped its own `ATTRIBUTION.md` recording
   the copy.
3. **Here:** the five files we need (`claude`, `codex`, `gemini`, `opencode`, `copilot`) transcribed
   into React components. The only edit to the geometry is `fill="white"` → `fill="currentColor"`,
   so a mark inherits the surrounding text colour and works in both themes without a second asset.

Those five share a `0 0 100 100` viewBox and are single-colour, which is why they read as one set at
14px in a menu row. The opencode glyph is taken from the same CodexBar set rather than from
opencode's own `packages/identity/mark.svg`: the official mark is a 512px two-tone lockup with a
background plate, and mixing it into a row of monochrome 100px glyphs looks like a mistake.

## Trademarks

Provider names and marks remain the property of their respective owners. They are used here
nominatively — to identify which third-party CLI a button launches — and imply no affiliation with
or endorsement by Anthropic, OpenAI, Google, or the opencode project.

## The sixth mark: Hermes

`HermesMark` is NOT from the CodexBar set, which has no Hermes icon. It is transcribed from the
agent's own `acp_registry/icon.svg` —
[`NousResearch/hermes-agent`](https://github.com/NousResearch), MIT, Copyright (c) 2025 Nous
Research — verbatim, including `stroke="currentColor"` as the source already wrote it.

It is the one glyph that breaks the set's geometry: a `0 0 16 16` box drawn with strokes, not a
`0 0 100 100` filled path. That is deliberate. The stroke widths are authored for 16px and hold
their weight at the 14px a menu row uses, and redrawing it as a filled 100×100 path to match the
others would mean inventing geometry its author did not draw — the same reason the opencode glyph
came from CodexBar rather than from opencode's own two-tone lockup.

Redistributed license texts and copyright notices are included in [`LICENSES/`](./LICENSES/) for
CodexBar, Hermes Agent, and the recorded OpenClaw intermediate.
