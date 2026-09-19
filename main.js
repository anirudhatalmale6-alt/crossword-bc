/* ==================================================================
   Crossword matching game

   How BC (the blinking cell) travels:
     - rightward along a word, one cell per correct letter
     - if it is walled in on the right by a black square or the grid
       edge, it turns and works downward until that word is finished
     - a letter already filled in by a crossing word is stepped over,
       never asked for twice
     - when the word runs out it jumps to the next empty cell,
       reading the grid top to bottom, left to right
   On this puzzle that path covers all 44 cells with none stranded.

   Fixes in this rewrite:
   1. Win is counted from the grid (44 cells) not a hardcoded 24, so
      the puzzle can be finished. Works on any grid size.
   2. #play-again-btn does not exist in the HTML - showing it threw.
      We show #endMessage instead, and guard the button.
   3. Sounds preloaded once, every play() guarded, so a missing file
      can never stop the game.
   4. Cells found by data-pair, not by reading inline styles.
   5. Two click listeners instead of 118.

   NOTE: main.css needs one change - under #endMessage, set
   margin-top to 2rem (it is 200rem = 2000px, which pushes the
   whole board off screen once the message is shown).
   ================================================================== */

'use strict';

/* ---------------------------------------------------------------- */
/* Elements                                                          */
/* ---------------------------------------------------------------- */

const scoreSection = document.querySelector('.score');
const correctSpan  = scoreSection.querySelector('.correct');
const totalSpan    = scoreSection.querySelector('.total');

const bigBox       = document.querySelector('.big-box');
const grid         = document.querySelector('table');
const abcContainer = document.querySelector('.abc-container');
const endMessage   = document.querySelector('#endMessage');
const playAgainBtn = document.querySelector('#play-again-btn'); // optional

const smallBox1 = document.querySelector('.smallBox1');
const smallBox2 = document.querySelector('.smallBox2');
const smallBox3 = document.querySelector('.smallBox3');

const smallBox1Button = document.querySelector('#smallBox1Button');
const smallBox2Button = document.querySelector('#smallBox2Button');
const smallBox3Button = document.querySelector('#smallBox3Button');

/* ---------------------------------------------------------------- */
/* State                                                             */
/* ---------------------------------------------------------------- */

let selectedCell = null;
let correct = 0;
let total = 0;
let finished = false;

/* Which way BC travels after a correct letter: 'across' or 'down'. */
let direction = 'across';

/* ---------------------------------------------------------------- */
/* Cells                                                             */
/* ---------------------------------------------------------------- */

const allCells = Array.from(document.querySelectorAll('.cell'));

/* A cell is playable only if it carries a letter. The black squares
   and the blank spacers around the grid have no data-pair. */
const isPlayable = cell => Boolean(cell && cell.dataset.pair);
const isSolved   = cell => cell.classList.contains('matched');
const isOpen     = cell => isPlayable(cell) && !isSolved(cell);

/* Counted once, from the board that is actually on the page. */
const TOTAL_PLAYABLE = allCells.filter(isPlayable).length;

/* ---------------------------------------------------------------- */
/* Sound                                                             */
/* ---------------------------------------------------------------- */

const sounds = {
  correct: new Audio('ding.mp3'),
  wrong:   new Audio('wrong answer.mp3'),
  end:     new Audio('../chime.mp3')
};

Object.values(sounds).forEach(audio => { audio.preload = 'auto'; });

function playSound(name) {
  const audio = sounds[name];
  if (!audio) return;
  audio.currentTime = 0;
  /* play() rejects if the file is missing or autoplay is blocked.
     Swallow it - a sound must never stop the game. */
  const played = audio.play();
  if (played && typeof played.catch === 'function') played.catch(() => {});
}

/* ---------------------------------------------------------------- */
/* Grid geometry                                                     */
/* ---------------------------------------------------------------- */

/* The board as rows of cells, so we can walk down a column as well
   as along a row. Every row in the table has the same number of
   cells, so a cell's index within its row is its column. */
const rows = Array.from(grid.querySelectorAll('tr'))
  .map(row => Array.from(row.querySelectorAll('.cell')));

const position = new Map();
rows.forEach((row, r) => row.forEach((cell, c) => position.set(cell, { r, c })));

const cellAt = (r, c) => (rows[r] ? rows[r][c] || null : null);

/* Move `distance` cells from `cell`. Negative distance goes back.  */
function step(cell, direction, distance) {
  const at = position.get(cell);
  if (!at) return null;
  return direction === 'down'
    ? cellAt(at.r + distance, at.c)
    : cellAt(at.r, at.c + distance);
}

/* The black squares, worked out once at load.

   This has to tell a black square apart from the pale spacer cells
   that pad the grid out to ten columns, because the two behave
   differently: a black square turns BC downward, a spacer does not.
   The E at the end of BAKE has a spacer to its right, and BC has to
   carry on to the next row from there rather than dive down. */
const blackCells = new Set(
  allCells.filter(cell =>
    !cell.dataset.pair &&
    getComputedStyle(cell).backgroundColor === 'rgb(0, 0, 0)')
);

/* Is BC walled in on its right? A black square, or the grid edge. */
function blockedRight(cell) {
  const right = step(cell, 'across', 1);
  return !right || blackCells.has(right);
}

/* ---------------------------------------------------------------- */
/* Selection                                                         */
/* ---------------------------------------------------------------- */

function clearSelection() {
  if (selectedCell) selectedCell.classList.remove('selected');
  selectedCell = null;
}

function selectCell(cell) {
  if (!cell) return;
  clearSelection();
  selectedCell = cell;
  cell.classList.add('selected');
}

/* Start the player on clue 1. */
function selectInitialCell() {
  const first = allCells.find(
    cell => cell.querySelector('span')?.textContent.trim() === '1'
  );
  if (first) selectCell(first);
}

/* Next unfilled cell along, in one direction. Stops dead at a black
   square, a spacer or the grid edge, and steps over any letter a
   crossing word has already filled in. */
function nextInRun(from, dir) {
  for (let d = 1; ; d += 1) {
    const next = step(from, dir, d);
    if (!next || !isPlayable(next)) return null;   // run ended
    if (!isSolved(next)) return next;
  }
}

/* Nothing left in this word - find the next empty cell on the board,
   reading top to bottom, left to right. */
const nextByScan = () => allCells.find(isOpen) || null;

/* Where BC goes after a correct letter.

   Rightward along the word. If it is walled in on the right it turns
   and works downward instead, and keeps going down until that word
   is finished, whatever is to its right on the way. When the word
   runs out it jumps to the next empty cell on the board. */
function advanceAfterCorrect(from) {
  let next = null;

  if (direction === 'down') {
    next = nextInRun(from, 'down');
    if (!next) direction = 'across';          // down word finished
  } else if (blockedRight(from)) {
    next = nextInRun(from, 'down');
    if (next) direction = 'down';             // turn and descend
  } else {
    next = nextInRun(from, 'across');
  }

  if (!next) {
    direction = 'across';
    next = nextByScan();
  }

  selectCell(next);
}

/* ---------------------------------------------------------------- */
/* Score                                                             */
/* ---------------------------------------------------------------- */

function updateScore() {
  correctSpan.textContent = correct;
  totalSpan.textContent = total;

  /* .score has a 0.2s opacity transition. Setting 0 then 1 in the
     same tick never rendered the 0, so nothing ever faded. Two
     frames apart, it does. */
  scoreSection.style.opacity = '0';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { scoreSection.style.opacity = '1'; });
  });
}

/* ---------------------------------------------------------------- */
/* End of game                                                       */
/* ---------------------------------------------------------------- */

function finish() {
  if (finished) return;
  finished = true;

  clearSelection();

  bigBox.style.display = 'flex';
  abcContainer.style.display = 'none';
  smallBox1.style.display = 'none';
  smallBox2.style.display = 'none';
  smallBox3.style.display = 'flex';

  if (endMessage) {
    endMessage.style.display = 'flex';
    /* The player finishes at the bottom of the grid, so bring the
       message to them rather than leaving it off-screen above. */
    endMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (playAgainBtn) playAgainBtn.style.display = 'flex';

  playSound('end');
}

/* ---------------------------------------------------------------- */
/* Clue panels                                                       */
/* ---------------------------------------------------------------- */

function showClues(which) {
  smallBox1.style.display = which === 1 ? 'block' : 'none';
  smallBox2.style.display = which === 2 ? 'block' : 'none';
  smallBox3.style.display = which === 3 ? 'block' : 'none';

  if (which === 2) smallBox2.classList.add('smallBox2-entrance');
  if (which === 3) smallBox3.classList.add('smallBox3-entrance');
}

smallBox1Button?.addEventListener('click', () => showClues(1));
smallBox2Button?.addEventListener('click', () => showClues(2));
smallBox3Button?.addEventListener('click', () => showClues(3));

/* ---------------------------------------------------------------- */
/* Clicking the grid                                                 */
/* ---------------------------------------------------------------- */

grid.addEventListener('click', event => {
  if (finished) return;

  /* The letter and the clue number sit in child elements, so walk up. */
  const cell = event.target.closest('.cell');
  if (!cell || !isOpen(cell)) return;

  if (cell === selectedCell) {
    clearSelection();          // click the selected cell again to drop it
  } else {
    /* Picking a cell by hand starts BC off rightward again. If that
       cell is walled in on the right it will turn downward by itself
       on the next correct letter. */
    direction = 'across';
    selectCell(cell);
  }
});

/* ---------------------------------------------------------------- */
/* Clicking a letter                                                 */
/* ---------------------------------------------------------------- */

abcContainer.addEventListener('click', event => {
  if (finished) return;

  const letter = event.target.closest('.abc');
  if (!letter || !selectedCell) return;

  total += 1;

  if (letter.dataset.pair === selectedCell.dataset.pair) {
    correct += 1;

    const solvedCell = selectedCell;
    solvedCell.classList.remove('selected');
    solvedCell.classList.add('matched');
    selectedCell = null;

    playSound('correct');
    advanceAfterCorrect(solvedCell);
  } else {
    playSound('wrong');
  }

  updateScore();

  if (correct >= TOTAL_PLAYABLE) finish();
});

/* ---------------------------------------------------------------- */
/* Go                                                                */
/* ---------------------------------------------------------------- */

selectInitialCell();
