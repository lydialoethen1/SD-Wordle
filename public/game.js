(() => {
  const $ = id => document.getElementById(id);

  const joinScreen    = $('join-screen');
  const waitingScreen = $('waiting-screen');
  const gameScreen    = $('game-screen');
  const lbOverlay     = $('leaderboard-overlay');

  const nameInput    = $('name-input');
  const joinBtn      = $('join-btn');
  const timerEl      = $('timer');
  const timerBar     = $('timer-bar');
  const playerCount  = $('player-count');
  const incidentLabel= $('incident-label');
  const gridEl       = $('grid');
  const keyboardEl   = $('keyboard');
  const statusMsg    = $('status-msg');
  const toastCont    = $('toast-container');
  const waitingCount = $('waiting-count');
  const waitingBubbles = $('waiting-bubbles');
  const lbList       = $('leaderboard-list');
  const revealedWord = $('revealed-word');
  const nextTimerEl  = $('next-timer');
  const lbProgress   = $('lb-progress');

  const ROWS = 6, COLS = 5, TOTAL_TIME = 300, LB_SECS = 18;

  let socket, currentRow = 0, currentCol = 0, currentInput = '';
  let gameOver = false, solved = false, lbCountdown;

  function showScreen(id) {
    [joinScreen, waitingScreen, gameScreen].forEach(s => {
      s.style.display = 'none'; s.classList.remove('active');
    });
    const s = $(id);
    if (s) { s.style.display = 'flex'; s.classList.add('active'); }
  }

  // ── Grid ──
  function buildGrid() {
    gridEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement('div');
      row.classList.add('grid-row'); row.dataset.row = r;
      for (let c = 0; c < COLS; c++) {
        const tile = document.createElement('div');
        tile.classList.add('tile'); tile.dataset.row = r; tile.dataset.col = c;
        row.appendChild(tile);
      }
      gridEl.appendChild(row);
    }
  }

  // ── Keyboard ──
  const KEY_ROWS = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['ENTER','Z','X','C','V','B','N','M','⌫']
  ];
  function buildKeyboard() {
    keyboardEl.innerHTML = '';
    KEY_ROWS.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.classList.add('key-row');
      row.forEach(k => {
        const btn = document.createElement('button');
        btn.classList.add('key'); btn.textContent = k; btn.dataset.key = k;
        if (k === 'ENTER' || k === '⌫') btn.classList.add('wide');
        btn.addEventListener('click', () => handleKey(k));
        rowEl.appendChild(btn);
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  const getTile  = (r, c) => gridEl.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
  const getRowEl = r => gridEl.querySelector(`.grid-row[data-row="${r}"]`);

  function revealRow(row, result, onDone) {
    for (let c = 0; c < COLS; c++) {
      const tile = getTile(row, c);
      setTimeout(() => {
        tile.style.transform = 'scaleY(0)';
        setTimeout(() => {
          tile.dataset.state = result[c]; tile.classList.add('revealed');
          tile.style.transform = 'scaleY(1)';
          if (c === COLS - 1 && onDone) onDone();
        }, 150);
      }, c * 280);
    }
  }

  function bounceRow(row) {
    for (let c = 0; c < COLS; c++) {
      setTimeout(() => {
        const t = getTile(row, c); t.classList.add('bounce');
        t.addEventListener('animationend', () => t.classList.remove('bounce'), { once: true });
      }, c * 80);
    }
  }

  function shakeRow(row) {
    const r = getRowEl(row); r.classList.add('shake');
    r.addEventListener('animationend', () => r.classList.remove('shake'), { once: true });
  }

  const letterStates = {}, STATE_PRI = { correct:3, present:2, absent:1 };
  function updateKeyboard(guess, result) {
    guess.split('').forEach((l, i) => {
      const s = result[i], cur = letterStates[l];
      if (!cur || (STATE_PRI[s]||0) > (STATE_PRI[cur]||0)) letterStates[l] = s;
    });
    document.querySelectorAll('.key').forEach(btn => {
      const s = letterStates[btn.dataset.key]; if (s) btn.dataset.state = s;
    });
  }

  function updateTimer(secs) {
    timerEl.textContent = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
    timerBar.style.width = `${(secs/TOTAL_TIME)*100}%`;
    if (secs > 120) { timerEl.className = 'timer-value'; timerBar.style.background = '#22c55e'; }
    else if (secs > 60) { timerEl.className = 'timer-value warning'; timerBar.style.background = '#FFBC0D'; }
    else { timerEl.className = 'timer-value danger'; timerBar.style.background = '#DA291C'; }
  }

  function showStatus(msg, type, dur = 2500) {
    statusMsg.textContent = msg; statusMsg.className = `status-msg ${type}`;
    if (dur > 0) setTimeout(() => statusMsg.classList.add('hidden'), dur);
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.classList.add('toast'); if (type) el.classList.add(type);
    el.textContent = msg; toastCont.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  const knownBubbles = new Set();
  function updateWaitingPlayers(players) {
    waitingCount.textContent = players.length;
    playerCount.textContent  = players.length;
    players.forEach(p => {
      if (!knownBubbles.has(p.name)) {
        knownBubbles.add(p.name);
        const b = document.createElement('div'); b.classList.add('player-bubble');
        b.textContent = p.name; waitingBubbles.appendChild(b);
      }
    });
  }

  function showLeaderboard(data) {
    lbOverlay.classList.remove('hidden');
    revealedWord.textContent = data.word;
    lbList.innerHTML = '';
    if (!data.leaderboard?.length) {
      lbList.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:16px">No one completed this round</p>';
    } else {
      data.leaderboard.forEach(p => {
        const el = document.createElement('div');
        el.classList.add('lb-entry', `rank-${p.rank}`);
        if (!p.solved) el.classList.add('lb-unsolved');
        const medal = p.rank===1?'🥇':p.rank===2?'🥈':p.rank===3?'🥉':p.rank;
        const t = p.solved&&p.time!=null ? `${Math.floor(p.time/60)}:${String(p.time%60).padStart(2,'0')}` : '—';
        el.innerHTML = `<div class="lb-rank">${medal}</div><div class="lb-name">${esc(p.name)}</div>
          <div class="lb-details"><div class="lb-score">${p.solved?p.score.toLocaleString():'—'}</div>
          <div class="lb-meta">${p.solved?`${p.guesses} guess${p.guesses!==1?'es':''} · ${t}`:'Did not solve'}</div></div>`;
        lbList.appendChild(el);
      });
    }
    let secs = LB_SECS; nextTimerEl.textContent = secs; lbProgress.style.width = '100%';
    clearInterval(lbCountdown);
    lbCountdown = setInterval(() => {
      secs--; nextTimerEl.textContent = secs;
      lbProgress.style.width = `${(secs/LB_SECS)*100}%`;
      if (secs <= 0) clearInterval(lbCountdown);
    }, 1000);
  }

  function hideLeaderboard() { lbOverlay.classList.add('hidden'); clearInterval(lbCountdown); }

  function resetBoard() {
    currentRow = 0; currentCol = 0; currentInput = '';
    gameOver = false; solved = false;
    Object.keys(letterStates).forEach(k => delete letterStates[k]);
    buildGrid(); buildKeyboard(); statusMsg.classList.add('hidden');
  }

  function handleKey(key) {
    if (gameOver || solved) return;
    if (key === '⌫' || key === 'Backspace') {
      if (currentCol > 0) { currentCol--; currentInput = currentInput.slice(0,-1); const t = getTile(currentRow, currentCol); t.textContent = ''; t.classList.remove('filled'); }
      return;
    }
    if (key === 'ENTER' || key === 'Enter') {
      if (currentCol < COLS) { shakeRow(currentRow); showStatus('Not enough letters', 'error'); return; }
      socket.emit('guess', { guess: currentInput }); return;
    }
    if (/^[A-Za-z]$/.test(key) && currentCol < COLS) {
      const t = getTile(currentRow, currentCol);
      t.textContent = key.toUpperCase(); t.classList.add('filled');
      currentInput += key.toUpperCase(); currentCol++;
    }
  }

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement === nameInput) return;
    if (e.key === 'Backspace') { handleKey('Backspace'); return; }
    if (e.key === 'Enter')     { handleKey('Enter');     return; }
    if (/^[A-Za-z]$/.test(e.key)) handleKey(e.key);
  });

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ── Socket ──
  function connect(name) {
    socket = io();
    socket.emit('join', { name });

    socket.on('game-state', data => {
      incidentLabel.textContent = `Round #${String(data.gameId).padStart(3,'0')}`;
      updateTimer(data.timeLeft);
      if (data.phase === 'waiting') showScreen('waiting-screen');
      else if (data.phase === 'playing') { buildGrid(); buildKeyboard(); showScreen('game-screen'); }
    });

    socket.on('game-started', ({ gameId }) => {
      incidentLabel.textContent = `Round #${String(gameId).padStart(3,'0')}`;
      updateTimer(TOTAL_TIME); resetBoard(); knownBubbles.clear();
      showScreen('game-screen');
      toast('🚨 Game Master started the round — GO!', 'alert');
    });

    socket.on('timer-update', ({ timeLeft }) => updateTimer(timeLeft));

    socket.on('player-list', ({ players, count }) => {
      playerCount.textContent = count; updateWaitingPlayers(players);
    });

    socket.on('guess-result', ({ guess, result, solved: didSolve, failed }) => {
      revealRow(currentRow, result, () => {
        updateKeyboard(guess, result);
        if (didSolve)  { solved = true;   bounceRow(currentRow); showStatus('Solved it! Great work! ✓', 'success', 0); }
        else if (failed){ gameOver = true; showStatus('Better luck next round!', 'error', 0); }
      });
      currentRow++; currentCol = 0; currentInput = '';
    });

    socket.on('player-solved', ({ name, guesses }) => {
      toast(`🎯 ${name} solved it in ${guesses} guess${guesses===1?'':'es'}!`, 'alert');
    });

    socket.on('game-over', data => { gameOver = true; showLeaderboard(data); });

    socket.on('back-to-waiting', ({ gameId }) => {
      hideLeaderboard(); gameOver = false; solved = false;
      incidentLabel.textContent = `Round #${String(gameId).padStart(3,'0')}`;
      updateTimer(TOTAL_TIME); knownBubbles.clear(); waitingBubbles.innerHTML = '';
      showScreen('waiting-screen');
    });
  }

  // ── Join ──
  function joinGame() {
    const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; }
    joinBtn.disabled = true;
    connect(name);
    showScreen('waiting-screen');
  }

  joinBtn.addEventListener('click', joinGame);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
})();
