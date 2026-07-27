/* SD WORDLE — Multiplayer Live Server */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Dedicated Game Master route — keep this URL private
app.get('/gm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gm.html'));
});

const WORDS = [
  // ── McDonald's — menu, brand & restaurant ops ──────────────────────────────
  'FRIES','SHAKE','PATTY','FILET','HAPPY','BACON','SAUCE','RANCH','APPLE','CRISP',
  'SWEET','HONEY','LARGE','SMALL','TOAST','GRILL','LUNCH','SNACK','ORDER','STRAW',
  'MAPLE','EXTRA','THICK','SPICY','VALUE','ROLLS','SERVE','DOUGH','MEALS','BITES',
  'SIDES','MENUS','COMBO','ONION','WHEAT','FRESH','SALAD','FRIED','WRAPS','JUICE',
  'STAFF','STORE','BRAND','DEALS','PROMO','KIOSK','GUEST','BOOTH','DRINK','SMILE',
  'SUPER','COCOA','CHEWY','DAIRY','CRUST','BEEFY','TASTY','MOCHA','COLAS','DRIVE',
  'CLEAN','QUICK','DAILY',

  // ── Service Delivery, Operations & Project Management ─────────────────────
  'AGENT','AGILE','ALERT','ALIGN','AUDIT','BATCH','BUILD','CALLS','CHAIN','CHART',
  'CHECK','CHIEF','CLAIM','CLEAR','CLOSE','CLOUD','CYCLE','DEBUG','DELTA','DEPOT',
  'DRAFT','EMAIL','ENTRY','EVENT','FAULT','FIELD','FINAL','FIXED','FLASH','FLEET',
  'FOCUS','FORCE','FORUM','FRAME','FRONT','GAUGE','GOALS','GRADE','GRAPH','GUARD',
  'GUIDE','INDEX','INPUT','INTEL','ISSUE','ITEMS','JUDGE','LAYER','LEADS','LEARN',
  'LEGAL','LEVEL','LIMIT','LINKS','LOCAL','LOGIC','MACRO','MAJOR','MATCH','MEDIA',
  'MERGE','MICRO','MODEL','NOTCH','OFFER','ONSET','OUTER','PATCH','PAUSE','PHASE',
  'PHONE','PILOT','PLACE','PLANS','POINT','POWER','PRESS','PRIME','PRIOR','PROBE',
  'PROOF','PROXY','PULSE','QUERY','QUEUE','RADAR','RAISE','RALLY','RANGE','RAPID',
  'RATIO','REACH','READY','REFER','RELAY','RISKS','ROBOT','ROLES','ROUTE','RULES',
  'SCALE','SCOPE','SCOUT','SCRUM','SETUP','SHIFT','SKILL','SLATE','SMART','SOLID',
  'SOLVE','SPEED','SPLIT','STAGE','START','STATE','STATS','STEPS','STORM','SURGE',
  'SWIFT','TABLE','TASKS','TEAMS','THEME','TIMER','TOOLS','TOTAL','TOUCH','TRACE',
  'TRACK','TRAIN','TRAIT','TREND','TRIAL','TRUST','TRUTH','UNITY','USAGE','VAULT',
  'VITAL','VOICE','WATCH','WORTH','YIELD','ZONES','PIVOT','RETRO','STORY','BLOCK',
  'SPIKE','OWNER','STAND','BRIEF','INBOX','REPLY','FLAGS','NOTES','LANES','SPACE',

  // ── Accounting & Finance ───────────────────────────────────────────────────
  'ASSET','BILLS','BONDS','BOOKS','COSTS','DEBTS','DEBIT','FLOAT','FOREX','FUNDS',
  'GAINS','GRANT','GROSS','HEDGE','LEDGE','LOANS','OWING','PETTY','QUOTA','RATES',
  'RECON','REMIT','REPAY','SHEET','SPEND','STAKE','TALLY','TAXES','TERMS','WRITE',
  'AMEND','QUOTE','PRICE','MONTH','PAYEE','STOCK','SALES','FILED',
];

const GAME_DURATION = 300;

let gameState = {
  word: '',
  phase: 'waiting', // 'waiting' | 'playing' | 'leaderboard'
  timeLeft: GAME_DURATION,
  players: {},
  gms: new Set(),
  gameId: 1
};

let timerInterval = null;

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function checkGuess(guess, word) {
  const result = new Array(5).fill('absent');
  const wordArr = word.split('');
  const guessArr = guess.split('');
  const used = new Array(5).fill(false);
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === wordArr[i]) { result[i] = 'correct'; used[i] = true; }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    for (let j = 0; j < 5; j++) {
      if (!used[j] && guessArr[i] === wordArr[j]) { result[i] = 'present'; used[j] = true; break; }
    }
  }
  return result;
}

function calculateScore(numGuesses, solveTime) {
  return (7 - numGuesses) * 1000 + Math.max(0, GAME_DURATION - solveTime);
}

function getLeaderboard() {
  const players = Object.values(gameState.players);
  const solved   = players.filter(p => p.solved).sort((a, b) => b.score - a.score);
  const unsolved = players.filter(p => !p.solved);
  return [...solved, ...unsolved].slice(0, 5).map((p, i) => ({
    rank: i + 1, name: p.name, solved: p.solved,
    guesses: p.guesses.length, score: p.score, time: p.solveTime
  }));
}

function getPlayerList() {
  return Object.entries(gameState.players).map(([id, p]) => ({
    id, name: p.name, solved: p.solved, guesses: p.guesses.length, failed: !p.solved && p.guesses.length >= 6
  }));
}

function broadcastPlayerList() {
  const list = getPlayerList();
  io.emit('player-list', { players: list, count: list.length });
}

function resetToWaiting() {
  clearInterval(timerInterval);
  gameState.word = pickWord();
  gameState.phase = 'waiting';
  gameState.timeLeft = GAME_DURATION;
  gameState.gameId++;
  for (const id in gameState.players) {
    Object.assign(gameState.players[id], { guesses: [], solved: false, solveTime: null, score: 0, failed: false });
  }
  io.emit('back-to-waiting', { gameId: gameState.gameId });
}

function endGame() {
  clearInterval(timerInterval);
  gameState.phase = 'leaderboard';
  io.emit('game-over', { leaderboard: getLeaderboard(), word: gameState.word });
  // GM must manually trigger next round via gm-new-round
}

function startGame() {
  if (gameState.phase !== 'waiting') return;
  gameState.phase = 'playing';
  // Broadcast word only to GMs, not players
  gameState.gms.forEach(gmId => {
    io.to(gmId).emit('gm-word-reveal', { word: gameState.word });
  });
  io.emit('game-started', { gameId: gameState.gameId });
  timerInterval = setInterval(() => {
    if (gameState.phase !== 'playing') return;
    gameState.timeLeft--;
    io.emit('timer-update', { timeLeft: gameState.timeLeft });
    if (gameState.timeLeft <= 0) endGame();
  }, 1000);
}

io.on('connection', (socket) => {

  // ── Player join ──
  socket.on('join', ({ name }) => {
    const cleanName = ((name || '').trim().substring(0, 20)) || 'Anonymous';
    gameState.players[socket.id] = { name: cleanName, guesses: [], solved: false, solveTime: null, score: 0 };

    socket.emit('game-state', {
      phase: gameState.phase,
      timeLeft: gameState.timeLeft,
      gameId: gameState.gameId
    });
    if (gameState.phase === 'leaderboard') {
      socket.emit('game-over', { leaderboard: getLeaderboard(), word: gameState.word });
    }
    broadcastPlayerList();
    console.log(`Player joined: ${cleanName} — ${Object.keys(gameState.players).length} total`);
  });

  // ── GM join ──
  socket.on('join-gm', () => {
    gameState.gms.add(socket.id);
    socket.emit('gm-state', {
      phase: gameState.phase,
      timeLeft: gameState.timeLeft,
      gameId: gameState.gameId,
      word: gameState.phase !== 'waiting' ? gameState.word : null,
      players: getPlayerList(),
      count: Object.keys(gameState.players).length
    });
    if (gameState.phase === 'leaderboard') {
      socket.emit('game-over', { leaderboard: getLeaderboard(), word: gameState.word });
    }
    console.log(`Game Master connected: ${socket.id}`);
  });

  // ── GM controls ──
  socket.on('gm-start', () => {
    if (!gameState.gms.has(socket.id) || gameState.phase !== 'waiting') return;
    startGame();
    console.log('Game Master started the game');
  });

  socket.on('gm-end', () => {
    if (!gameState.gms.has(socket.id) || gameState.phase !== 'playing') return;
    endGame();
    console.log('Game Master ended the game early');
  });

  socket.on('gm-new-round', () => {
    if (!gameState.gms.has(socket.id)) return;
    resetToWaiting();
    console.log('Game Master started a new round');
  });

  // ── Guess ──
  socket.on('guess', ({ guess }) => {
    const player = gameState.players[socket.id];
    if (!player || gameState.phase !== 'playing' || player.solved || player.guesses.length >= 6) return;
    const clean = (guess || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length !== 5) return;

    const result = checkGuess(clean, gameState.word);
    player.guesses.push({ word: clean, result });

    const solved = result.every(r => r === 'correct');
    const failed = !solved && player.guesses.length >= 6;

    if (solved) {
      player.solved = true;
      player.solveTime = GAME_DURATION - gameState.timeLeft;
      player.score = calculateScore(player.guesses.length, player.solveTime);
      io.emit('player-solved', { name: player.name, guesses: player.guesses.length });
    }
    if (failed) player.failed = true;

    socket.emit('guess-result', { guess: clean, result, solved, failed });
    // Keep GMs updated with live player progress
    broadcastPlayerList();
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    gameState.gms.delete(socket.id);
    if (gameState.players[socket.id]) {
      console.log(`Player left: ${gameState.players[socket.id].name}`);
      delete gameState.players[socket.id];
      broadcastPlayerList();
    }
  });
});

gameState.word = pickWord();

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  let localIP = 'YOUR_IP';
  for (const iface of Object.values(nets)) {
    const hit = (iface || []).find(a => a.family === 'IPv4' && !a.internal);
    if (hit) { localIP = hit.address; break; }
  }
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      SD WORDLE  —  LIVE MULTIPLAYER       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}           ║`);
  console.log(`║  Network: http://${localIP}:${PORT}    ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Share the Network URL with your team!    ║');
  console.log('║  Click "Game Master Access" to host.      ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
