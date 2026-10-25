@AGENTS.md

For visible UI changes, maintain the optional screenshot scenarios and assertions described in
[scripts/screenshots/README.md](scripts/screenshots/README.md). Keep the semantic names stable,
review the captures, and use the scoped update command to refresh documentation references. These
tests run only when requested or needed for the current UI change; do not add them to normal CI.

When local subagents are available, send broad searches to `Explore`, focused test, type and lint
runs to `test-runner`, and library documentation questions to `docs-lookup`, so their output stays
out of the main conversation.

# Compact instructions

When compacting, keep: the task and the user's decisions, files changed and why, the failing test or
check and its exact error, rule ids (A1–A8, C1–C7, X1–X5) the change touches, and open items. Drop
passing test output, file contents that can be re-read, and search results already acted on.
