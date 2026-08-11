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
  // ── McDonald's ─────────────────────────────────────────────────────────────
  { word: 'FRIES', hint: 'Golden and crispy, served in every size' },
  { word: 'SHAKE', hint: 'Cold, thick, and comes in three classic flavors' },
  { word: 'SAUCE', hint: 'The secret behind every great dip or burger' },
  { word: 'HAPPY', hint: 'A famous meal named after a feeling' },
  { word: 'KIOSK', hint: 'The self-service stand replacing the counter queue' },
  { word: 'BACON', hint: 'Smoky strips that upgrade any sandwich' },
  { word: 'SUGAR', hint: 'The sweet ingredient behind every McCafé treat' },

  // ── Accounting & Finance ───────────────────────────────────────────────────
  { word: 'DEBIT', hint: 'Money leaving an account — the opposite of credit' },
  { word: 'AUDIT', hint: 'An official inspection of financial records' },
  { word: 'REMIT', hint: 'To send or transfer payment to another party' },
  { word: 'GROSS', hint: 'The total amount before any deductions' },
  { word: 'TRADE', hint: 'The exchange of goods, services, or assets' },
  { word: 'ASSET', hint: 'Anything of value that a company owns' },
  { word: 'YIELD', hint: 'The return generated from an investment' },
  { word: 'CLOSE', hint: 'When a financial period or deal comes to an end' },
  { word: 'ENTRY', hint: 'A single recorded line in the financial books' },
  { word: 'TAXES', hint: 'What every company pays to the government on earnings' },

  // ── Service Delivery & Project Management ─────────────────────────────────
  { word: 'WAVES', hint: 'How the global rollout is being phased across markets' },
  { word: 'SCOPE', hint: "Defines what's in — and out — of a project" },
  { word: 'PHASE', hint: 'A defined stage in the project lifecycle' },
];

const GAME_DURATION = 300;

let gameState = {
  word: '',
  hint: '',
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
  const picked = pickWord();
  gameState.word = picked.word;
  gameState.hint = picked.hint;
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
  io.emit('game-started', { gameId: gameState.gameId, hint: gameState.hint });
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
      gameId: gameState.gameId,
      hint: gameState.phase === 'playing' ? gameState.hint : null
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

const initial = pickWord();
gameState.word = initial.word;
gameState.hint = initial.hint;

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
