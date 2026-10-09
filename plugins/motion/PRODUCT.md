# Motion Studio

## Platform

Web UI inside the Localix workbench and Tauri desktop shell.

## Users and purpose

Localix users and their agents create motion videos together. The user requested a library of
different video types, comparable to the Resumes template gallery, and a clean interface consistent
with Localix. The library shows projects and a quiet plus action; an empty library keeps that action
centered. Creation opens a separate workbench page with a previewable template chooser or a blank
canvas. Returning from a preview retains the chooser's filter, selection, scroll and keyboard focus.
The user requested dark motion films inspired by typographic hooks and cinematic product reveals.
Users edit scenes, review timing and export the result. Agents author the same structured project
through a plugin tool.

## Constraints

Use the host kit and visual tokens. Preserve user edits when an agent writes concurrently. Keep the
project available after closing the pane. Show the visible document as agent context. Public copy is
English. Template examples are illustrative content, not factual product claims.

## Implementation decisions

Frame-driven canvas compositions provide the same output for preview, seeking and video export.
Authored scenes and keyframed layers are data, with no arbitrary generated script execution.
Templates cover product, typography, social, explainer, data, brand, event and editorial videos.
Blackout, Relay and Nightfall provide original dark typographic, product and brand directions.
Reusable geometric layers and motion recipes remain editable. Working files use the conversation
workspace `.localix/motion/`, matching Resumes. Ordinary actions inherit the shared quiet button
style; creating a project uses an icon with an accessible label and tooltip. Browser codec support
determines local video export availability. Assets and projects are private to the signed-in user.
