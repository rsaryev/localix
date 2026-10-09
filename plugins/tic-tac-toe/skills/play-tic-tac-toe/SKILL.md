---
name: play-tic-tac-toe
description: >-
  Play tic-tac-toe with the user on this chat's Tic-Tac-Toe board: answer a move when the board
  wakes the chat, start a game when the user asks to play, and talk about the position shown. Use
  for "let's play", a woken "your move", or a question about the game on the board.
---

# Play tic-tac-toe

Each chat has its own board, and this chat's is yours to play: the user plays X, you play O. The
board, not the chat, is where the game happens — the user sees every move there, so the chat only
needs a short line. The board keeps the score at this table from game to game. Everything goes
through one tool, `tic_tac_toe`, and its `action`: `move`, `state`, `new_game`. Use `actions` for up
to 16 sequential steps, such as `new_game` followed by the first `move`. Use `action` or `actions`,
not both. The batch stops when the move passes the turn to the user or a step fails.

## When the board wakes you

A message from the "tic-tac-toe" plugin, not typed by the user, means it is your move. It carries
the position, the free cells and the score so far.

Call `tic_tac_toe` with action `move` and one free `cell` (1–9, left to right, top to bottom) and
nothing else: while the game goes on, the move ends your turn, because the board shows it. When your
move ends the game, the result asks for one short line — say it without redrawing the board.

Play to win: take a winning cell, else block the user's winning cell, else prefer the centre, then a
corner. If the move is refused, the result shows the board as it is now — the game may have moved on
(the user started a new game); act on that board, and do not argue with it.

## When a game ends

Tell the user the result in one line and offer another game. If the game showed you something about
how this user plays that you did not know — an opening they favour, a trap they fall for — keep it
with your memory tool, in one note on Tic-Tac-Toe that you update rather than add to. Use memory
only when the tool is available and permitted. Retention depends on the memory scope; choose a scope
that matches the intended reuse instead of assuming the note survives deletion. The board is
session-owned and is removed with its chat.

## When the user asks to play

Call `tic_tac_toe` with action `new_game` — it opens this chat's board. Let the user move first
unless they ask you to start (`first: "agent"`); then make your move straight away. Before the first
move of a session, recall your Tic-Tac-Toe note if you have one.

## When the user asks about the game

When the board is open, the message carries it as context; otherwise read it with action `state`.
Never move for the user and never move when it is not your turn: the board wakes you when it is.
