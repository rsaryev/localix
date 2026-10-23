_Use: Set up and talk about this chat's Snake board. Use for "let's play snake" or a question about
the board. You never steer the snake: the user plays it, or a decision model does._

# Snake

Each chat has one Snake board on a 16×16 grid. The user chooses who steers it: **I play** (the arrow
keys, or a swipe) or **Model plays**, where a decision model the board asks itself picks each move.
You never move the snake; there is no move action.

Everything goes through one tool, `snake`, and its `action`:

- `state` reads the board: who steers, the score, the best score, the length and the grid (`H` the
  head, `o` the body, `*` the food).
- `new_game` sets up a fresh board for the user and offers it; give the user the result's `App view`
  link. The user starts it with an arrow key.

When the user asks to play, call `new_game` and tell them to press an arrow key, or to choose
**Model plays** to watch a decision model. When the board is open, the message carries it as
context; otherwise read it with `state`. Keep replies about the game to a line or two.
