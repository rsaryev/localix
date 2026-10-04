## Summary

<!-- What changed, why it matters, and what is deliberately out of scope. -->

-

## User-visible result

<!-- Describe the behavior before and after. Use "No user-visible change" when appropriate. -->

## Evidence

<!-- List the exact commands run and their result. Add before/after screenshots or a short recording for UI changes. -->

- [ ] Repository-wide required checks from `CONTRIBUTING.md` passed; exact results are listed above
- [ ] `bun run check:rust` passed for Rust changes, or not applicable
- [ ] `bun run --cwd apps/landing generate` passed for public Markdown, or not applicable
- [ ] UI evidence attached, or not applicable

## Risk and rollback

<!-- Call out permissions, persistence, agent-runtime, migration, or cross-platform risk and the safest rollback. -->

## Checklist

- [ ] The change is focused and follows [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] Tests cover new production behavior or the reason they do not is documented above.
- [ ] Documentation reflects user-visible or public API changes.
- [ ] No credentials, private project data, generated output, or local paths are included.
