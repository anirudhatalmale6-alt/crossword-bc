/* ==================================================================
   Crossword matching game

   How BC (the blinking cell) travels:
     - it works through one word at a time, in the order set by
       WORD_ORDER below - change that list to change the order
     - inside a word it runs left to right, or top to bottom if it
       is a down word
     - a letter already filled in by a crossing word is stepped over,
       never asked for twice
     - when a word is finished it moves to the next word in the list
       that still has empty cells
   On this puzzle that covers all 44 cells with none stranded.

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

/* ---------------------------------------------------------------- */
/* Words                                                             */
/* ---------------------------------------------------------------- */

/* The order BC works through the puzzle.

   THIS LIST IS THE ORDER. To change it, reorder these words - there
   is nothing else to edit. Any word on the board that is missing
   from the list still gets played, after all the listed ones, so
   the puzzle can always be finished. */
const WORD_ORDER = [
  'bake', 'beat', 'arms', 'melt', 'earn', 'mind', 'lava', 'able',
  'need', 'draw', 'tend', 'wish', 'tear', 'idle', 'hear', 'ease'
];

/* Every across and down run of two or more letters on the board,
   read straight off the grid - no answer list to keep in step. */
function findWords() {
  const found = [];
  allCells.forEach(cell => {
    if (!isPlayable(cell)) return;
    ['across', 'down'].forEach(dir => {
      const before = step(cell, dir, -1);
      const after = step(cell, dir, 1);
      if (isPlayable(before) || !isPlayable(after)) return;   // not a start
      const cells = [];
      for (let d = 0; ; d += 1) {
        const next = step(cell, dir, d);
        if (!isPlayable(next)) break;
        cells.push(next);
      }
      found.push({ dir, cells, text: cells.map(c => c.dataset.pair).join('') });
    });
  });
  return found;
}

/* Sorted into playing order. Unlisted words fall to the back, and
   Array.sort is stable so they keep their grid order among
   themselves. */
const rank = word => {
  const i = WORD_ORDER.indexOf(word.text);
  return i < 0 ? WORD_ORDER.length : i;
};
const words = findWords().sort((a, b) => rank(a) - rank(b));

/* The word BC is currently working through. */
let currentWord = null;

const wordsWith = cell => words.filter(word => word.cells.includes(cell));

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

/* Where BC goes next.

   It finishes the word it is on, then moves to the next word in
   WORD_ORDER that still has empty cells. Within a word it runs
   left to right, or top to bottom for a down word, and steps over
   any letter a crossing word has already filled in - the player is
   never asked for the same letter twice. */
function advance() {
  if (currentWord) {
    const rest = currentWord.cells.find(isOpen);
    if (rest) { selectCell(rest); return; }    // same word, next gap
  }

  for (const word of words) {
    const cell = word.cells.find(isOpen);
    if (cell) {
      currentWord = word;
      selectCell(cell);
      return;
    }
  }

  currentWord = null;      // board finished
  clearSelection();
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
    /* Picking a cell by hand switches BC to the word that cell
       belongs to, so it carries on from there rather than snapping
       back to wherever it was. */
    currentWord = wordsWith(cell).find(word => word.cells.some(isOpen)) || null;
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
    advance();
  } else {
    playSound('wrong');
  }

  updateScore();

  if (correct >= TOTAL_PLAYABLE) finish();
});

/* ---------------------------------------------------------------- */
/* Go                                                                */
/* ---------------------------------------------------------------- */

/* Starts BC on the first empty cell of the first word in the order. */
advance();
