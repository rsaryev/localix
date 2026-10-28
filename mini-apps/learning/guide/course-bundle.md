# Learning course bundle v1

All paths are relative to the manifest that declares them. Absolute paths, `..` escapes, and
symlinks leaving the course root are rejected. Course, module, lesson, objective, and step IDs must
be unique across the course and use kebab-case. Quiz option IDs belong to their question and may
repeat in other questions; keep them distinct within a question.

## Generation contract

Courses always prepare one complete module at a time. Create a coherent outline for the whole route,
author every lesson in the first module, and leave later modules pending. Do not ask the learner to
choose progressive versus upfront generation. The app can request the next pending module when at
least half of the current module’s lessons are completed (rounded up), or its last lesson opens. A
pending current module takes priority. A missed or failed tutor wake leaves generation failed rather
than preparing material; inspect that state and use a reachable tutor to continue.

Warm requests are bounded to three attempts per pending module. A queued request suppresses another
request for 15 minutes; failed requests cannot retry sooner than 60 seconds after the last request.
These conditions are checked when the course is read or updated through a route that warms it, not
by an independent retry timer. A delivered wake remains queued until preparation succeeds or later
course activity detects the stale request. At the attempt limit, inspect the failure and prepare the
pending module manually in the canonical bundle; activating ready lessons clears that module's
pending-generation record.

Ask only for missing goals, experience, depth or time constraints. Reuse preferences already given.
Use small modules of 2–4 focused lessons so a prepared module is useful without a long wait. Plan
backwards from the final observable outcome. Order modules by the concepts and skills their tasks
depend on, then give each lesson a distinct measurable objective. Keep one practical project or
domain thread across modules; each module ends with a task combining its new skills. Later modules
briefly retrieve earlier concepts and revisit weak first attempts before introducing more. Prefer
this explicit prerequisite sequence to a branching graph unless the learner needs genuinely
independent paths. Avoid disconnected chapters, duplicate objectives and a long theory-only opening.

Write one compact outline JSON file, then use `learning_course` action `draft` with `outline_path`.
This creates all course, module and pending lesson manifests without overwriting existing drafts.
The outline uses the course fields below (without `schemaVersion`), but embeds modules as
`{id, title, description, lessons}` and lessons as `{id, title, summary, estimatedMinutes}` instead
of file paths. Next author only the requested module’s steps and Markdown with ordinary file tools.

Use action `validate` for a dry run before `activate`. New courses require the entire first module
ready. For existing courses, action `get` returns a compact outline, saved learner evidence and
canonical `manifest_path`; add `lesson_id` or `step_id` for focused material. Edit that bundle in
place and activate the same root once the module is ready. Never recreate the course to repair one
file, and never rewrite other modules during warm-up.

## Quality checklist

- Each lesson teaches one central idea with explicit objectives and useful prerequisites.
- Explain the mental model, then one worked example, then a fresh transfer task. State assumptions
  and why the example works, including boundary cases; avoid repeating prose with cosmetic changes.
- Keep retrieval focused: normally 3–7 plausible diagnostic questions, each targeting a different
  distinction, ordered from recognition to application. Explain why the correct answer works.
- Keep distractors plausible and similar in length. Avoid positional hints and "all of the above";
  display order is automatically shuffled while option ids and saved answers stay stable.
- Give practice observable criteria. The learner submits a solution; the tutor checks every
  criterion and records specific feedback with action `review`, using the current `submission_id`
  from `get`'s `assessments[step_id].submissionId`. Stale IDs are refused; a repeated review of an
  already reviewed ID retains its result. A passing review enables learner continuation but does not
  complete the step. Reading is not proof of mastery.
- Use earlier first-attempt mistakes and practice feedback to choose examples and guidance. Do not
  manufacture progress or change difficulty solely because the learner clicked Continue.
- Research authoritative sources for changing facts. Cite links in the Markdown you write, use only
  sources actually read, and never invent evidence when a research call fails. Use another
  authoritative route or mark the uncertain detail explicitly. Avoid unnecessary research for stable
  concepts already supported by supplied material.
- Use standard Markdown with labelled code fences (`sql`, `python`, etc.), tables and callouts. The
  host renders the same Markdown and code components as the conversation.
- Read manifests and content back, check references and unique ids, then validate once. Patch the
  reported file on failure; activate only when the requested module is complete.
- Keep stable ids for compatible material. Changes to quiz questions/options, practice prompts or
  criteria, or flashcards invalidate their evidence; theory polish preserves compatible progress.
  Quiz explanations and practice hints are outside the assessed-task revision. Changing a correct
  answer or the stored option order also changes a quiz's revision, even if its step id stays
  stable.

```text
<course-id>/
  course.json
  modules/
    <module-id>/
      module.json
      lessons/
        <lesson-id>/
          lesson.json
          steps/
            <step-id>/
              step.json
              content.md
```

## Validation boundaries

- A pending lesson must have empty objectives and steps. A ready lesson must include theory
  (`concept`, `code`, or `walkthrough`), testing (`quiz` or `flashcards`), and practice, in that
  order. Three to seven quiz questions is authoring guidance; the validator enforces a maximum of
  ten and accepts flashcards as testing.
- Course and module manifests allow up to 32 modules and 32 lessons per module. A lesson allows up
  to 32 steps and 12 objectives. Quiz questions allow 2–8 options; `correctOptionId` must name one
  of them.
- Each JSON file is limited to 256,000 bytes; Markdown and code-source files to 512,000 bytes.
  Narrative file references must end in `.md`.
- Activation imports only files reachable from the manifests, not the surrounding directory.
  Continue editing the returned canonical `manifest_path` for an existing course.

The examples below are manifest fragments. The ready lesson requires all five referenced step
manifests and their content files; the first quiz example must be repeated with distinct step IDs
and appropriate questions for `retrieval-check-2` and `retrieval-check-3`.

## `course.json`

```json
{
  "schemaVersion": 1,
  "id": "agent-harness",
  "title": "Agent Harness",
  "topic": "Reliable AI agents",
  "goal": "Build and evaluate a safe agent runtime",
  "description": "A practical course.",
  "level": "intermediate",
  "language": "English",
  "estimatedMinutes": 180,
  "modules": ["modules/runtime/module.json"]
}
```

## `module.json`

```json
{
  "id": "runtime",
  "title": "Runtime",
  "description": "The controlled execution loop.",
  "lessons": ["lessons/agent-loop/lesson.json"]
}
```

## `lesson.json`

Pending shell:

```json
{
  "id": "agent-loop",
  "title": "The agent loop",
  "summary": "From observation to verified action.",
  "estimatedMinutes": 35,
  "generationStatus": "pending",
  "objectives": [],
  "steps": []
}
```

Ready lesson references step manifests in learning order:

```json
{
  "id": "agent-loop",
  "title": "The agent loop",
  "summary": "From observation to verified action.",
  "estimatedMinutes": 35,
  "generationStatus": "ready",
  "objectives": [{ "id": "trace-loop", "text": "Trace the complete loop" }],
  "steps": [
    "steps/mental-model/step.json",
    "steps/retrieval-check-1/step.json",
    "steps/retrieval-check-2/step.json",
    "steps/retrieval-check-3/step.json",
    "steps/design-runtime/step.json"
  ]
}
```

Each quiz question is its own step file. A normal ready lesson should contain 3–7 quiz steps in one
contiguous testing block; 10 is the enforced maximum. The reader shows one question at a time and
keeps later quiz steps locked until the current answer is correct.

## Step manifests

Concept theory — lecture body must be Markdown:

```json
{
  "id": "mental-model",
  "type": "concept",
  "title": "The controlled loop",
  "content": "content.md",
  "keyPoints": ["Validate before side effects"]
}
```

Code theory — source is a separate code file. The optional explanation is Markdown; include it when
the source needs teaching context:

```json
{
  "id": "runtime-code",
  "type": "code",
  "title": "Minimal runtime",
  "language": "typescript",
  "source": "example.ts",
  "content": "explanation.md"
}
```

Quiz — feedback is Markdown:

```json
{
  "id": "retrieval-check-1",
  "type": "quiz",
  "question": "What happens before a tool call?",
  "options": [
    { "id": "a", "label": "Validate policy and arguments" },
    { "id": "b", "label": "Execute arbitrary input" }
  ],
  "correctOptionId": "a",
  "explanation": "explanation.md"
}
```

Practice — prompt and optional hint are Markdown:

```json
{
  "id": "design-runtime",
  "type": "practice",
  "title": "Design a runtime",
  "prompt": "prompt.md",
  "acceptanceCriteria": ["Defines a stop condition", "Validates tool arguments"],
  "hint": "hint.md"
}
```

Flashcards — testing material stays inline in the step manifest:

```json
{
  "id": "recall-runtime",
  "type": "flashcards",
  "title": "Recall the runtime boundaries",
  "cards": [{ "front": "When is policy checked?", "back": "Before the tool runs." }]
}
```

Walkthrough — theory material stays inline, with at least two stages:

```json
{
  "id": "trace-runtime",
  "type": "walkthrough",
  "title": "Trace one tool call",
  "steps": [
    { "label": "Validate", "detail": "Check policy and arguments before execution." },
    { "label": "Observe", "detail": "Record the result and decide whether another step is needed." }
  ]
}
```

## Source of truth

- [Bundle schemas and path guards](../backend/course-bundle.ts)
- [Import file selection](../backend/course-import.ts)
- [Module generation](../backend/module-generation.ts)
- [Assessed-task revision fields](../shared/task-content.ts)
- [Progress reconciliation](../backend/materialize-course.ts)
- [Tool actions and canonical paths](../backend/tool.ts)
