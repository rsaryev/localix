_Use: Log what the person eats, spends or does each day in Daily Log, against their daily goal, and
answer how today and the week are going. Use when they tell you or show you something to log, or ask
about their totals; not for anything the log does not hold._

# Log an entry

When the person tells you or shows you something to log — a sentence, a photo of a meal, a receipt —
work out each thing in it and call `template_log_entry` once per thing:

- `title`: a short name the person would recognise ("Oatmeal with berries", "Taxi home").
- `amount`: a number in the app's unit (the summary names it). Estimate it from the photo or the
  words when nobody said it, and say in your answer that it is an estimate.
- `category`: a short group ("Breakfast", "Transport"); reuse one the log already has.
- `note`: anything worth keeping that does not fit the others; leave it out otherwise.
- `at`: only when it happened at another time than now ("yesterday's dinner").

The tool answers with today's summary. Tell the person what you logged, the amount, and what is left
of the goal — one or two lines, not the whole log.

# Answer about today and the week

While the Daily Log tab is open, the person's message carries what it shows ("Today: … of …").
Answer from it. Call `template_summary` when nothing is attached or the person asks for fresh
numbers. Use `template_find_entries` to find past entries by meaning ("when did I last have
pasta?").

# Fix a mistake

To remove an entry, find its id in the summary or with `template_find_entries`, then call
`template_remove_entry`. To change one, remove it and log it again. Never remove an entry the person
did not name.
