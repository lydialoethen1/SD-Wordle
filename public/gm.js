(() => {
  const $ = id => document.getElementById(id);

  const phasePill    = $('gm-phase-pill');
  const playerTable  = $('player-table');
  const countBadge   = $('gm-count-badge');
  const gmTimer      = $('gm-timer');
  const gmPlayerCount= $('gm-player-count');
  const gmWord       = $('gm-word');
  const btnStart     = $('btn-start');
  const btnEnd       = $('btn-end');
  const btnNew       = $('btn-new');
  const controlsHint = $('controls-hint');
  const lbOverlay    = $('lb-overlay');
  const lbList       = $('lb-list');
  const lbWord       = $('lb-word');
  const lbTimerEl    = $('lb-timer');
  const lbBar        = $('lb-bar');
  const btnLbNew     = $('btn-lb-new');

  const TOTAL_TIME = 300, LB_SECS = 18;
  let lbCountdown;

  const socket = io();
  socket.emit('join-gm');

  // ── Phase UI ──
  function setPhase(phase) {
    phasePill.textContent = phase.toUpperCase();
    phasePill.className = `gm-phase-pill ${phase}`;

    btnStart.style.display = phase === 'waiting'     ? '' : 'none';
    btnEnd.style.display   = phase === 'playing'     ? '' : 'none';
    btnNew.style.display   = phase === 'leaderboard' ? '' : 'none';

    if (phase === 'waiting') {
      btnStart.disabled = false;
      controlsHint.textContent = 'Players are in the lobby waiting. Press Start when everyone has joined.';
    } else if (phase === 'playing') {
      controlsHint.textContent = 'Game is live. End early if needed — leaderboard will display for everyone.';
    } else {
      controlsHint.textContent = 'Leaderboard is showing to all players. Start the next round when ready.';
    }
  }

  // ── Timer ──
  function updateTimer(secs) {
    const str = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
    gmTimer.textContent = str;
    gmTimer.className = secs > 120 ? 'info-tile-value timer-green'
                      : secs > 60  ? 'info-tile-value timer-gold'
                      : 'info-tile-value timer-red';
  }

  // ── Player list ──
  function renderPlayers(players) {
    const count = players.length;
    countBadge.textContent    = count;
    gmPlayerCount.textContent = count;

    if (count === 0) {
      playerTable.innerHTML = `<div class="empty-players">No players have joined yet.<br>Share the game URL with participants.</div>`;
      return;
    }

    playerTable.innerHTML = '';
    players.forEach(p => {
      const row = document.createElement('div');
      let chipClass = 'chip-ready', chipText = 'Waiting';
      if (p.solved)           { chipClass = 'chip-solved';  chipText = `Solved (${p.guesses})`; row.classList.add('solved'); }
      else if (p.failed)      { chipClass = 'chip-failed';  chipText = 'Failed';                row.classList.add('failed'); }
      else if (p.guesses > 0) { chipClass = 'chip-playing'; chipText = `${p.guesses} guess${p.guesses!==1?'es':''}`; }

      row.classList.add('player-row');
      row.innerHTML = `
        <div class="player-avatar">${esc(p.name.charAt(0))}</div>
        <span class="player-name">${esc(p.name)}</span>
        <span class="player-guesses">${p.guesses > 0 && !p.solved && !p.failed ? '' : ''}</span>
        <span class="player-status-chip ${chipClass}">${chipText}</span>`;
      playerTable.appendChild(row);
    });
  }

  // ── Leaderboard ──
  function showLeaderboard(data) {
    lbWord.textContent = data.word;
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
          <div class="lb-details">
            <div class="lb-score">${p.solved ? p.score.toLocaleString() : '—'}</div>
            <div class="lb-meta">${p.solved ? `${p.guesses} guess${p.guesses!==1?'es':''} · ${t}` : 'Did not solve'}</div>
          </div>`;
        lbList.appendChild(el);
      });
    }

    lbOverlay.classList.remove('hidden');

    let secs = LB_SECS; lbTimerEl.textContent = secs; lbBar.style.width = '100%';
    clearInterval(lbCountdown);
    lbCountdown = setInterval(() => {
      secs--; lbTimerEl.textContent = secs;
      lbBar.style.width = `${(secs/LB_SECS)*100}%`;
      if (secs <= 0) clearInterval(lbCountdown);
    }, 1000);
  }

  function hideLeaderboard() {
    lbOverlay.classList.add('hidden');
    clearInterval(lbCountdown);
  }

  // ── Socket events ──
  socket.on('gm-state', data => {
    updateTimer(data.timeLeft);
    setPhase(data.phase);
    renderPlayers(data.players || []);
    if (data.word) {
      gmWord.className = 'word-card-value';
      gmWord.textContent = data.word;
    }
    if (data.phase === 'leaderboard') {
      // will receive game-over separately
    }
  });

  socket.on('gm-word-reveal', ({ word }) => {
    gmWord.className = 'word-card-value';
    gmWord.textContent = word;
  });

  socket.on('timer-update', ({ timeLeft }) => updateTimer(timeLeft));

  socket.on('player-list', ({ players }) => renderPlayers(players));

  socket.on('game-started', ({ gameId }) => {
    setPhase('playing');
    updateTimer(TOTAL_TIME);
  });

  socket.on('game-over', data => {
    setPhase('leaderboard');
    showLeaderboard(data);
  });

  socket.on('back-to-waiting', ({ gameId }) => {
    hideLeaderboard();
    setPhase('waiting');
    updateTimer(TOTAL_TIME);
    gmWord.className = 'word-card-hidden';
    gmWord.textContent = 'Starts when game begins';
  });

  // ── Button handlers ──
  btnStart.addEventListener('click', () => {
    btnStart.disabled = true;
    socket.emit('gm-start');
  });

  btnEnd.addEventListener('click', () => {
    if (confirm('End the game now and show the leaderboard to all players?')) {
      socket.emit('gm-end');
    }
  });

  btnNew.addEventListener('click', () => {
    socket.emit('gm-new-round');
    hideLeaderboard();
  });

  btnLbNew.addEventListener('click', () => {
    socket.emit('gm-new-round');
    hideLeaderboard();
  });

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
})();
