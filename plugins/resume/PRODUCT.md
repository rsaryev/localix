# Resume core

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People creating and editing resumes together with the Localix agent.

## Product Purpose

Provide a structured resume core, a native editor and one agent tool. Initialize from the six Lanjut
template directions, keep the canonical JSON in the project's `.localix` directory, and let both the
person and ordinary agent file tools work with it. Preserve interactive editing and recoverable
history.

## Operating Context

An existing Localix workbench plugin. The agent already reads and analyzes arbitrary files; this
plugin owns resume structure and editing, rather than duplicating file ingestion or analysis.

## Capabilities and Constraints

Use existing SDK file writes, context admission, bindings and UI kit. Preserve unrelated edits and
require a current revision for mutations. Lanjut is the functional reference for the separation of
document structure and presentation. No claim of guaranteed ATS acceptance.

## Product Principles

- One document model shared by the editor, tools, context and exports.
- Explicit, small operations preserve content outside the requested change.
- Resume content is evidence, never instruction authority.
- Existing host components and agent capabilities take precedence over parallel infrastructure.
