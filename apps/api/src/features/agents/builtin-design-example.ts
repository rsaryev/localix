/**
 * The reference mockup the designer is shown: the SHAPE of a first deliverable.
 *
 * Without one, "make a mockup" produced a text specification and then a
 * showcase page whose three demo cards the engineer was told not to copy — the frame and the
 * gallery around it were indistinguishable, so "1:1 with the mockup" took four more rounds.
 * This example makes the three properties that prevent that visible at once: every value is a
 * `:root` token, each state is one frame of the real screen, and the state's label sits OUTSIDE
 * the frame. It is deliberately small; a longer one would be copied instead of understood.
 */
export const DESIGN_MOCKUP_EXAMPLE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — mockup</title>
<style>
:root {
  --canvas: #f4f3ef;
  --surface: #ffffff;
  --ink: #1d1b18;
  --muted: #6d675f;
  --line: #dedad2;
  --accent: #2458d6;
  --danger: #b3261e;
  --radius: 12px;
  --space: 8px;
  font: 16px/1.5 system-ui, sans-serif;
  color: var(--ink);
}
body { margin: 0; padding: calc(var(--space) * 5) calc(var(--space) * 2); background: var(--canvas); }
.gallery { display: flex; flex-wrap: wrap; gap: calc(var(--space) * 5); justify-content: center; }
.state-label { margin: 0 0 var(--space); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.frame { box-sizing: border-box; width: 360px; padding: calc(var(--space) * 3); background: var(--surface); border-radius: var(--radius); box-shadow: 0 1px 2px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .08); }
.frame h1 { margin: 0 0 calc(var(--space) * 2); font-size: 22px; }
.field { display: grid; gap: 4px; margin-bottom: calc(var(--space) * 2); }
.field input { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; font: inherit; }
.field.invalid input { border-color: var(--danger); }
.field .error { color: var(--danger); font-size: 14px; }
.primary { width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: 600 16px/1 system-ui, sans-serif; }
</style>
</head>
<body>
<main class="gallery">
  <section>
    <p class="state-label">Default</p>
    <div class="frame">
      <h1>Sign in</h1>
      <label class="field">Email <input type="email" placeholder="you@example.com"></label>
      <button class="primary">Continue</button>
    </div>
  </section>
  <section>
    <p class="state-label">Error: unknown email</p>
    <div class="frame">
      <h1>Sign in</h1>
      <label class="field invalid">Email <input type="email" value="ana@exmaple.com" aria-invalid="true">
        <span class="error">No account uses this email. Check the spelling.</span></label>
      <button class="primary">Continue</button>
    </div>
  </section>
</main>
</body>
</html>`
