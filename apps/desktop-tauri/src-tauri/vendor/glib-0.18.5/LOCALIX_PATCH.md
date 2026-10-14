# Localix glib 0.18.5 backport

This directory is the `glib` 0.18.5 crate published on crates.io, with the soundness fix described
below and one repository-hygiene-only normalization: the extra blank line at the end of `LICENSE`
was removed.

- Crate archive SHA-256:
  `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`
- Advisory: `RUSTSEC-2024-0429` / `GHSA-wrw7-89jp-8q8g`
- Upstream fix: `gtk-rs/gtk-rs-core#1343`
- Upstream commit: `b5a4071e439bef2b5eea76c3aa25e5ae84839e34`

The backport changes the variadic GLib out-argument in `src/variant_iter.rs` from `&p` to
`&mut p`. No API, dependency, or generated binding changes are included.

Remove this patch when the Tauri Linux GTK dependency graph supports `glib >= 0.20`.
