/* SD WORDLE — Multiplayer Live Server */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

// ── Word bank with subtle hints ───────────────────────────────────
const WORD_BANK = [
  { word: 'FRIES', hint: "What Idaho does best, what the Golden Arches sells most" },
  { word: 'SHAKE', hint: "Dairy meets dessert — requires a straw, not a spoon" },
  { word: 'SAUCE', hint: "The unsung hero of any combo meal" },
  { word: 'HAPPY', hint: "A box, a toy, and a smile" },
  { word: 'KIOSK', hint: "The machine that cut the line" },
  { word: 'BACON', hint: "Sizzles before it hits the bun" },
  { word: 'SUGAR', hint: "Hiding in plain sight on every nutrition label" },
  { word: 'DEBIT', hint: "Dr. on the left — ask your accountant" },
  { word: 'AUDIT', hint: "What happens when trust alone is not enough" },
  { word: 'REMIT', hint: "Wire it, send it, settle it" },
  { word: 'GROSS', hint: "The headline number before the fine print" },
  { word: 'TRADE', hint: "What moves between ports and borders" },
  { word: 'ASSET', hint: "What survives on the balance sheet long-term" },
  { word: 'YIELD', hint: "The reward for patience and risk" },
  { word: 'CLOSE', hint: "What the finance team races to finish by the 5th" },
  { word: 'ENTRY', hint: "Dr. Cash, Cr. Revenue — just one of these" },
  { word: 'TAXES', hint: "Certain as death — Ben Franklin said so" },
  { word: 'WAVES', hint: "How a global launch gets sequenced" },
  { word: 'SCOPE', hint: "The first casualty of stakeholder requests" },
  { word: 'PHASE', hint: "Has a gate at the end, not a door" }
];

const GAME_DURATION = 300;

let gameState = {
  word: '', hint: '', phase: 'waiting',
  timeLeft: GAME_DURATION, players: {}, gms: new Set(),
  hostId: null, gameId: 1
};
let timerInterval = null;

// ── Helpers ───────────────────────────────────────────────────────
function pickEntry() {
  return WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
}

function checkGuess(guess, word) {
  const result = new Array(5).fill('absent');
  const wArr = word.split(''), gArr = guess.split(''), used = new Array(5).fill(false);
  for (let i = 0; i < 5; i++) { if (gArr[i] === wArr[i]) { result[i] = 'correct'; used[i] = true; } }
  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    for (let j = 0; j < 5; j++) {
      if (!used[j] && gArr[i] === wArr[j]) { result[i] = 'present'; used[j] = true; break; }
    }
  }
  return result;
}

function calculateScore(numGuesses, solveTime) {
  return (7 - numGuesses) * 1000 + Math.max(0, GAME_DURATION - solveTime);
}

function getPlayerList() {
  return Object.entries(gameState.players).map(([id, p]) => ({
    name: p.name, isHost: id === gameState.hostId,
    solved: p.solved, guesses: p.guesses.length,
    failed: !p.solved && p.guesses.length >= 6
  }));
}

function getLeaderboard() {
  const all = Object.values(gameState.players);
  const solved   = all.filter(p => p.solved).sort((a, b) => b.score - a.score);
  const unsolved = all.filter(p => !p.solved);
  return [...solved, ...unsolved].slice(0, 5).map((p, i) => ({
    rank: i + 1, name: p.name, solved: p.solved,
    guesses: p.guesses.length, score: p.score, time: p.solveTime
  }));
}

function broadcastPlayerList() {
  const players = getPlayerList();
  io.emit('player-list', { players, count: players.length });
}

function endGame() {
  clearInterval(timerInterval); timerInterval = null;
  gameState.phase = 'leaderboard';
  io.emit('game-over', { leaderboard: getLeaderboard(), word: gameState.word });
}

function startGame() {
  if (gameState.phase !== 'waiting') return;
  gameState.phase = 'playing';
  io.emit('game-started', { gameId: gameState.gameId, hint: gameState.hint });
  timerInterval = setInterval(() => {
    if (gameState.phase !== 'playing') return;
    gameState.timeLeft--;
    io.emit('timer-update', { timeLeft: gameState.timeLeft });
    if (gameState.timeLeft <= 0) endGame();
  }, 1000);
}

function resetToWaiting() {
  clearInterval(timerInterval); timerInterval = null;
  const entry = pickEntry();
  gameState.word = entry.word; gameState.hint = entry.hint;
  gameState.phase = 'waiting'; gameState.timeLeft = GAME_DURATION; gameState.gameId++;
  for (const id in gameState.players) {
    Object.assign(gameState.players[id], { guesses: [], solved: false, solveTime: null, score: 0, failed: false });
  }
  io.emit('back-to-waiting', { gameId: gameState.gameId });
}

// ── Socket handlers ───────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('join', ({ name }) => {
    const cleanName = ((name || '').trim().substring(0, 20)) || 'Anonymous';
    const isFirst   = Object.keys(gameState.players).length === 0;
    if (isFirst) gameState.hostId = socket.id;
    gameState.players[socket.id] = { name: cleanName, guesses: [], solved: false, solveTime: null, score: 0, failed: false };

    const isHost = socket.id === gameState.hostId;
    socket.emit('joined', {
      isHost, phase: gameState.phase, timeLeft: gameState.timeLeft,
      gameId: gameState.gameId, hint: gameState.phase === 'playing' ? gameState.hint : null,
      players: getPlayerList(), count: Object.keys(gameState.players).length
    });
    if (gameState.phase === 'leaderboard') socket.emit('game-over', { leaderboard: getLeaderboard(), word: gameState.word });
    broadcastPlayerList();
    console.log(`Joined: ${cleanName} [${isHost ? 'HOST' : 'player'}] — ${Object.keys(gameState.players).length} total`);
  });

  socket.on('join-gm', () => {
    gameState.gms.add(socket.id);
    socket.emit('gm-state', {
      phase: gameState.phase, timeLeft: gameState.timeLeft, gameId: gameState.gameId,
      word: gameState.word, hint: gameState.hint, players: getPlayerList(),
      count: Object.keys(gameState.players).length
    });
    if (gameState.phase === 'leaderboard') socket.emit('game-over', { leaderboard: getLeaderboard(), word: gameState.word });
    console.log('Game Master connected');
  });

  const canControl = (sid) => sid === gameState.hostId || gameState.gms.has(sid);

  socket.on('start-game',   () => { if (canControl(socket.id) && gameState.phase === 'waiting')     startGame(); });
  socket.on('back-to-lobby',() => { if (canControl(socket.id))                                      resetToWaiting(); });
  socket.on('gm-start',     () => { if (gameState.gms.has(socket.id) && gameState.phase === 'waiting') startGame(); });
  socket.on('gm-end',       () => { if (gameState.gms.has(socket.id) && gameState.phase === 'playing') endGame(); });
  socket.on('gm-new-round', () => { if (gameState.gms.has(socket.id))                               resetToWaiting(); });

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
    broadcastPlayerList();
    const all = Object.values(gameState.players);
    if (all.length > 0 && all.every(p => p.solved || p.guesses.length >= 6)) setTimeout(endGame, 1500);
  });

  socket.on('disconnect', () => {
    gameState.gms.delete(socket.id);
    const player = gameState.players[socket.id];
    if (!player) return;
    const wasHost = socket.id === gameState.hostId;
    console.log(`Left: ${player.name}${wasHost ? ' [HOST]' : ''}`);
    delete gameState.players[socket.id];
    if (wasHost) {
      const remaining = Object.keys(gameState.players);
      if (remaining.length > 0) {
        gameState.hostId = remaining[0];
        io.to(gameState.hostId).emit('promoted-to-host');
        console.log(`New host: ${gameState.players[gameState.hostId].name}`);
      } else { gameState.hostId = null; }
    }
    broadcastPlayerList();
  });
});

const entry = pickEntry(); gameState.word = entry.word; gameState.hint = entry.hint;

const PORT = 8080;
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
