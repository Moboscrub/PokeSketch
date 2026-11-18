/* Squint & Sketch — client */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const GEN_INFO = [
    [1, 'Kanto'], [2, 'Johto'], [3, 'Hoenn'], [4, 'Sinnoh'], [5, 'Unova'],
    [6, 'Kalos'], [7, 'Alola'], [8, 'Galar'], [9, 'Paldea'],
  ];
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
  const BLUR_PX = { light: 6, medium: 10, heavy: 15, brutal: 24 }; // at 500px card width
  const COLORS = ['#111111', '#ffffff', '#8a8f98', '#ef4444', '#f97316', '#facc15', '#22c55e', '#15803d', '#38bdf8',
    '#2563eb', '#8b5cf6', '#ec4899', '#f9a8d4', '#92400e', '#f5c99b', '#a3e635', '#0f766e'];

  // ------------------------------------------------------------ session
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('ss-session') || 'null'); } catch (_) { return null; } },
    set(v) { try { localStorage.setItem('ss-session', JSON.stringify(v)); } catch (_) { } },
    clear() { try { localStorage.removeItem('ss-session'); } catch (_) { } },
    name() { try { return localStorage.getItem('ss-name') || ''; } catch (_) { return ''; } },
    setName(n) { try { localStorage.setItem('ss-name', n); } catch (_) { } },
  };
  let session = null;   // {code,pid,token}
  let state = null;
  let es = null;
  let clockOffset = 0;
  let unloading = false;
  addEventListener('pagehide', () => { unloading = true; });
  addEventListener('beforeunload', () => { unloading = true; });
  addEventListener('pageshow', () => { unloading = false; });

  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  async function act(type, extra = {}) {
    if (!session) return;
    try { await api('/api/action', { ...session, type, ...extra }); }
    catch (e) { toast(e.message); throw e; }
  }

  // ------------------------------------------------------------ home
  const params = new URLSearchParams(location.search);
  $('#nameInput').value = store.name();
  if (params.get('room')) $('#codeInput').value = params.get('room').toUpperCase().slice(0, 4);

  function getName() {
    const n = $('#nameInput').value.trim();
    if (!n) { toast('Pick a name first!'); $('#nameInput').focus(); return null; }
    store.setName(n); return n;
  }
  $('#createBtn').onclick = async () => {
    const name = getName(); if (!name) return;
    try { const r = await api('/api/create', { name }); connect(r); } catch (e) { toast(e.message); }
  };
  async function join() {
    const name = getName(); if (!name) return;
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { toast('Room codes are 4 letters.'); return; }
    try { const r = await api('/api/join', { name, code }); connect(r); } catch (e) { toast(e.message); }
  }
  $('#joinBtn').onclick = join;
  $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('#codeInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  function connect(r) {
    session = { code: r.code, pid: r.pid, token: r.token };
    store.set(session);
    history.replaceState(null, '', '?room=' + r.code);
    if (es) es.close();
    es = new EventSource(`/api/events?code=${encodeURIComponent(session.code)}&pid=${encodeURIComponent(session.pid)}&token=${encodeURIComponent(session.token)}`);
    es.onmessage = ev => {
      const data = JSON.parse(ev.data);
      if (data.kicked) { leaveLocal('You were removed from the room.'); return; }
      clockOffset = data.serverNow - Date.now();
      state = data;
      render();
    };
    const mine = es;
    es.onerror = () => {
      // The browser also closes the stream while the page unloads; don't forget the session then.
      setTimeout(() => {
        if (!unloading && es === mine && mine.readyState === EventSource.CLOSED) leaveLocal('Lost the room (it may have closed).');
      }, 300);
    };
  }
  function leaveLocal(msg) {
    if (es) es.close(); es = null; session = null; state = null; store.clear();
    history.replaceState(null, '', location.pathname);
    drawRoundKey = null;
    showScreen('home'); if (msg) toast(msg);
  }
  $$('.leaveBtn').forEach(b => b.onclick = async () => {
    try { await act('leave'); } catch (_) { }
    leaveLocal();
  });

  // Try to resume a saved session (e.g. after a refresh).
  (async () => {
    const saved = store.get();
    const want = params.get('room');
    if (saved && (!want || want.toUpperCase() === saved.code)) {
      try { const r = await api('/api/join', { ...saved, name: store.name() || 'Trainer' }); connect(r); return; } catch (_) { store.clear(); }
    }
  })();

  // ------------------------------------------------------------ render
  function showScreen(id) { ['home', 'lobby', 'game'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id)); }
  const me = () => state && state.players.find(p => p.id === state.you);
  const isHost = () => state && state.hostId === state.you;

  function render() {
    if (!state) { showScreen('home'); return; }
    document.body.classList.toggle('is-host', isHost());
    if (state.phase === 'lobby') { showScreen('lobby'); renderLobby(); return; }
    showScreen('game');
    renderGame();
  }

  // ------------------------------------------------------------ lobby
  let namesKey = '';
  function loadNames(gens) {
    const key = gens.join(',');
    if (key === namesKey) return;
    namesKey = key;
    fetch('/api/names?gens=' + key).then(r => r.json()).then(j => {
      const dl = $('#pokeNames'); dl.innerHTML = '';
      for (const n of j.names || []) { const o = document.createElement('option'); o.value = n; dl.appendChild(o); }
    }).catch(() => { });
  }

  function renderPlayers(ul, opts = {}) {
    ul.innerHTML = '';
    const players = [...state.players];
    if (opts.byScore) players.sort((a, b) => b.score - a.score);
    for (const p of players) {
      const li = el('li'); if (!p.connected) li.classList.add('off');
      const dot = el('span', 'dot'); dot.style.background = p.color; li.appendChild(dot);
      li.appendChild(el('span', 'pname', p.name));
      if (p.id === state.hostId) { const h = el('span', 'tag', opts.byScore ? '👑' : '👑 host'); h.title = 'Host'; li.appendChild(h); }
      if (p.id === state.you) li.appendChild(el('span', 'tag', 'you'));
      if (opts.status) {
        let s = '';
        if (state.phase === 'drawing') s = p.submitted ? '✅' : '✏️';
        if (state.phase === 'voting') s = p.voted ? '✅' : '🤔';
        if (s) li.appendChild(el('span', 'status', s));
      }
      if (opts.byScore) li.appendChild(el('span', 'score', p.score));
      if (opts.kick && isHost() && p.id !== state.you) {
        const k = el('button', 'kick', '✕'); k.title = 'Remove ' + p.name;
        k.onclick = () => act('kick', { target: p.id }).catch(() => { });
        li.appendChild(k);
      }
      ul.appendChild(li);
    }
  }

  function renderLobby() {
    $('#roomCode').textContent = state.code;
    $('#playerCount').textContent = `(${state.players.length})`;
    renderPlayers($('#lobbyPlayers'), { kick: true });
    const host = isHost();
    $('#hostNote').textContent = host ? '' : '(host picks)';
    const s = state.settings;

    const gens = $('#gens'); gens.innerHTML = '';
    for (const [n, region] of GEN_INFO) {
      const b = el('button', 'gen' + (s.gens.includes(n) ? ' on' : ''));
      b.appendChild(el('b', null, ROMAN[n]));
      b.appendChild(el('small', null, region));
      b.disabled = !host;
      b.onclick = () => {
        let g = s.gens.includes(n) ? s.gens.filter(x => x !== n) : [...s.gens, n];
        if (!g.length) { toast('Keep at least one generation.'); return; }
        act('settings', { settings: { gens: g } }).catch(() => { });
      };
      gens.appendChild(b);
    }
    $$('.chips').forEach(box => {
      const key = box.dataset.setting, suffix = box.dataset.suffix || '';
      box.innerHTML = '';
      for (const raw of box.dataset.values.split(',')) {
        const val = isNaN(raw) ? raw : Number(raw);
        const c = el('button', 'chip' + (s[key] === val ? ' on' : ''), raw + suffix);
        c.disabled = !host;
        c.onclick = () => act('settings', { settings: { [key]: val } }).catch(() => { });
        box.appendChild(c);
      }
    });
    const t = $('#traceToggle'); t.checked = !!s.trace; t.disabled = !host;
    loadNames(s.gens);
  }
  $('#traceToggle').onchange = e => act('settings', { settings: { trace: e.target.checked } }).catch(() => { e.target.checked = !e.target.checked; });
  $('#gensAll').onclick = () => act('settings', { settings: { gens: [1, 2, 3, 4, 5, 6, 7, 8, 9] } }).catch(() => { });
  $('#gensKanto').onclick = () => act('settings', { settings: { gens: [1] } }).catch(() => { });
  $('#startBtn').onclick = () => act('start').catch(() => { });
  $('#copyLinkBtn').onclick = async () => {
    const link = `${location.origin}/?room=${state.code}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied!'); }
    catch (_) { toast(link, 6000); }
  };

  // ------------------------------------------------------------ blurred card rendering
  const imgCache = new Map();
  function loadImage(src) {
    if (!imgCache.has(src)) {
      imgCache.set(src, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { imgCache.delete(src); reject(new Error('Card image failed to load')); };
        img.src = src;
      }));
    }
    return imgCache.get(src);
  }
  const supportsCtxFilter = (() => { const c = document.createElement('canvas').getContext('2d'); return c && 'filter' in c; })();
  // Draws the card blurred into a 5:7 canvas (500 x 700).
  function drawBlurredCard(canvas, img, level) {
    const W = 500, H = 700;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const px = BLUR_PX[level] || 10;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (supportsCtxFilter) {
      ctx.filter = `blur(${px}px)`;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.filter = 'none';
    } else {
      // Fallback for browsers without canvas filters: shrink then stretch.
      const f = Math.max(2, px * 0.9);
      const t = document.createElement('canvas');
      t.width = Math.max(4, Math.round(W / f)); t.height = Math.max(4, Math.round(H / f));
      const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high';
      tc.drawImage(img, 0, 0, t.width, t.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t, 0, 0, W, H);
    }
  }
  async function blurredInto(canvas) {
    if (!state.card) return;
    try { const img = await loadImage(state.card.image); drawBlurredCard(canvas, img, state.settings.blur); }
    catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------ drawing pad
  const pad = {
    canvas: $('#drawCanvas'), ctx: null, tool: 'brush', color: '#111111', size: 5,
    history: [], drawing: false, last: null, dirty: false, transparent: false,
  };
  pad.ctx = pad.canvas.getContext('2d', { willReadFrequently: true });

  function resetPad(trace) {
    pad.transparent = trace;
    pad.canvas.width = trace ? 700 : 800;
    pad.canvas.height = trace ? 980 : 800;
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    if (!trace) { pad.ctx.fillStyle = '#fff'; pad.ctx.fillRect(0, 0, pad.canvas.width, pad.canvas.height); }
    pad.history = []; pad.dirty = false; pad.drawing = false;
  }
  function snapshot() {
    pad.history.push(pad.ctx.getImageData(0, 0, pad.canvas.width, pad.canvas.height));
    if (pad.history.length > 15) pad.history.shift();
  }
  function undo() {
    const prev = pad.history.pop();
    if (prev) pad.ctx.putImageData(prev, 0, 0);
  }
  function posOf(e) {
    const r = pad.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * pad.canvas.width / r.width, y: (e.clientY - r.top) * pad.canvas.height / r.height };
  }
  function scale() { return pad.canvas.width / 560; }
  function strokeTo(p) {
    const c = pad.ctx;
    c.save();
    if (pad.tool === 'eraser') {
      if (pad.transparent) { c.globalCompositeOperation = 'destination-out'; c.strokeStyle = '#000'; }
      else c.strokeStyle = '#fff';
    } else c.strokeStyle = pad.color;
    c.lineWidth = pad.size * scale() * (pad.tool === 'eraser' ? 1.8 : 1);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pad.last.x, pad.last.y); c.lineTo(p.x, p.y); c.stroke();
    c.restore();
    pad.last = p;
  }
  const locked = () => !state || state.phase !== 'drawing' || submittedRound === state.round;

  pad.canvas.addEventListener('pointerdown', e => {
    if (locked()) return;
    e.preventDefault();
    pad.canvas.setPointerCapture(e.pointerId);
    const p = posOf(e);
    snapshot();
    if (pad.tool === 'fill') { floodFill(Math.floor(p.x), Math.floor(p.y), pad.color); pad.dirty = true; return; }
    pad.drawing = true; pad.last = p; pad.dirty = true;
    strokeTo({ x: p.x + 0.01, y: p.y + 0.01 }); // a dot on tap
  });
  pad.canvas.addEventListener('pointermove', e => {
    if (!pad.drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) strokeTo(posOf(ev));
  });
  const stop = () => { pad.drawing = false; };
  pad.canvas.addEventListener('pointerup', stop);
  pad.canvas.addEventListener('pointercancel', stop);
  pad.canvas.addEventListener('lostpointercapture', stop);

  function hexToRgba(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  function floodFill(x, y, hex) {
    const { width: W, height: H } = pad.canvas;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const img = pad.ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const i0 = (y * W + x) * 4;
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const fill = hexToRgba(hex);
    if (target.every((v, i) => Math.abs(v - fill[i]) < 4)) return;
    const tol = 60;
    const match = i => Math.abs(d[i] - target[0]) <= tol && Math.abs(d[i + 1] - target[1]) <= tol && Math.abs(d[i + 2] - target[2]) <= tol && Math.abs(d[i + 3] - target[3]) <= tol;
    const seen = new Uint8Array(W * H);
    const stack = [[x, y]];
    while (stack.length) {
      let [cx, cy] = stack.pop();
      let idx = cy * W + cx;
      while (cx >= 0 && !seen[idx] && match(idx * 4)) { cx--; idx--; }
      cx++; idx++;
      let up = false, down = false;
      while (cx < W && !seen[idx] && match(idx * 4)) {
        seen[idx] = 1;
        const p = idx * 4; d[p] = fill[0]; d[p + 1] = fill[1]; d[p + 2] = fill[2]; d[p + 3] = 255;
        if (cy > 0) { const u = idx - W; if (!seen[u] && match(u * 4)) { if (!up) { stack.push([cx, cy - 1]); up = true; } } else up = false; }
        if (cy < H - 1) { const dn = idx + W; if (!seen[dn] && match(dn * 4)) { if (!down) { stack.push([cx, cy + 1]); down = true; } } else down = false; }
        cx++; idx++;
      }
    }
    // Soak up the anti-aliased fringe next to filled pixels.
    pad.ctx.putImageData(img, 0, 0);
  }

  // tools UI
  const sw = $('#swatches');
  COLORS.forEach((c, i) => {
    const b = el('button', 'swatch' + (i === 0 ? ' active' : '')); b.style.background = c; b.title = c;
    b.onclick = () => { pad.color = c; if (pad.tool === 'eraser') setTool('brush'); markSwatch(b); };
    sw.appendChild(b);
  });
  const custom = el('label', 'swatch custom'); const ci = document.createElement('input'); ci.type = 'color'; ci.value = '#ff00aa';
  ci.oninput = () => { pad.color = ci.value; custom.style.background = ci.value; if (pad.tool === 'eraser') setTool('brush'); markSwatch(custom); };
  custom.title = 'Custom color'; custom.appendChild(ci); sw.appendChild(custom);
  function markSwatch(b) { $$('.swatch').forEach(x => x.classList.toggle('active', x === b)); }
  function setTool(t) { pad.tool = t; $$('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t)); }
  $$('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $$('.size').forEach(b => b.onclick = () => { pad.size = Number(b.dataset.size); $$('.size').forEach(x => x.classList.toggle('active', x === b)); });
  $('#undoBtn').onclick = () => { if (!locked()) undo(); };
  $('#clearBtn').onclick = () => {
    if (locked()) return;
    snapshot();
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    if (!pad.transparent) { pad.ctx.fillStyle = '#fff'; pad.ctx.fillRect(0, 0, pad.canvas.width, pad.canvas.height); }
  };
  document.addEventListener('keydown', e => {
    if (!state || state.phase !== 'drawing' || e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!locked()) undo(); }
    else if (e.key === 'b') setTool('brush');
    else if (e.key === 'f') setTool('fill');
    else if (e.key === 'e') setTool('eraser');
  });

  // ------------------------------------------------------------ game views
  let drawRoundKey = null;     // which round the drawing view was set up for
  let submittedRound = -1;
  let submitting = false;
  let autoRound = -1;

  function showView(id) { $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== id)); }

  function renderGame() {
    $('#roundPill').textContent = state.phase === 'final' ? 'Game over' : `Round ${Math.max(1, state.round)}/${state.totalRounds}`;
    renderPlayers($('#scoreList'), { byScore: true, status: true });
    $('#skipBtn').classList.toggle('hidden', !['drawing', 'voting'].includes(state.phase));
    switch (state.phase) {
      case 'loading': showView('v-loading'); break;
      case 'error': showView('v-error'); $('#errorText').textContent = state.error || ''; break;
      case 'drawing': showView('v-draw'); setupDraw(); break;
      case 'voting': showView('v-vote'); renderVote(); break;
      case 'results': showView('v-results'); renderResults(); break;
      case 'final': showView('v-final'); renderFinal(); break;
    }
    tick();
  }

  function setupDraw() {
    const key = state.code + ':' + state.gameId + ':' + state.round + ':' + state.card.image;
    const trace = !!state.settings.trace;
    $('.draw-layout').classList.toggle('trace', trace);
    $('#stage').classList.toggle('trace', trace);
    if (drawRoundKey !== key) {
      drawRoundKey = key;
      submitting = false; submittedRound = -1; autoRound = -1;
      resetPad(trace);
      setTool('brush');
      $('#guessInput').value = '';
      blurredInto($('#refCanvas'));
      blurredInto($('#bgCanvas'));
      loadNames(state.settings.gens);
    }
    if (state.mySubmitted) submittedRound = state.round;
    const isLocked = submittedRound === state.round;
    $('#lockedOverlay').classList.toggle('hidden', !isLocked);
    $('#doneBtn').disabled = isLocked;
    $('#doneBtn').textContent = isLocked ? 'Locked in ✓' : 'Lock it in';
    $('#guessInput').disabled = isLocked;
  }

  function exportDrawing() {
    // Downscale a bit to keep uploads small.
    const s = 0.72;
    const c = document.createElement('canvas');
    c.width = Math.round(pad.canvas.width * s); c.height = Math.round(pad.canvas.height * s);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(pad.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  async function submitDrawing() {
    if (!state || state.phase !== 'drawing' || submittedRound === state.round || submitting) return;
    submitting = true;
    const round = state.round;
    try {
      await act('submit', { round, guess: $('#guessInput').value.trim(), blank: !pad.dirty, drawing: pad.dirty ? exportDrawing() : null });
      submittedRound = round;
      if (state && state.round === round) setupDraw();
    } catch (_) { /* toast already shown */ }
    finally { submitting = false; }
  }
  $('#doneBtn').onclick = submitDrawing;
  $('#guessInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitDrawing(); });

  function thumb(key, trace, extraCls = '') {
    const t = el('div', 'thumb' + (trace ? ' trace' : '') + (extraCls ? ' ' + extraCls : ''));
    if (trace) { const bg = document.createElement('canvas'); t.appendChild(bg); blurredInto(bg); }
    const img = new Image(); img.alt = 'Drawing'; img.src = `/api/drawing/${state.code}/${key}`;
    t.appendChild(img);
    return t;
  }

  let voteKey = null;
  function renderVote() {
    const sig = state.code + ':' + state.gameId + ':' + state.round + ':' + state.gallery.map(g => g.key).join(',');
    const myGuess = state.myGuess ? `You guessed “${state.myGuess}”. ` : '';
    $('#voteSub').textContent = myGuess + 'Pick your favorite (not your own). Names are hidden until the reveal.';
    const gal = $('#voteGallery');
    if (voteKey !== sig) {
      voteKey = sig; gal.innerHTML = '';
      for (const g of state.gallery) {
        const t = thumb(g.key, state.settings.trace, g.mine ? 'mine' : '');
        t.dataset.key = g.key;
        if (g.mine) t.appendChild(el('span', 'badge', 'Yours'));
        else t.onclick = () => act('vote', { key: g.key }).catch(() => { });
        gal.appendChild(t);
      }
    }
    $$('#voteGallery .thumb').forEach(t => {
      const picked = t.dataset.key === state.myVote;
      t.classList.toggle('picked', picked);
      let b = t.querySelector('.badge.vote');
      if (picked && !b) { b = el('span', 'badge vote', '⭐ Your vote'); t.appendChild(b); }
      if (!picked && b) b.remove();
    });
  }

  let resultsKey = null;
  function renderResults() {
    const sig = state.code + ':' + state.gameId + ':' + state.round;
    $('#nextBtn').textContent = state.results && state.results.isLast ? 'See final scores' : 'Next round';
    if (resultsKey === sig) return;
    resultsKey = sig;
    $('#revealImg').src = state.card.image;
    $('#revealName').textContent = state.card.name;
    $('#revealCard').textContent = [state.card.cardName, state.card.set].filter(Boolean).join(' · ');
    const gal = $('#resultsGallery'); gal.innerHTML = '';
    for (const r of state.results.rows) {
      const card = el('div', 'res-card' + (r.bestDrawing ? ' winner' : ''));
      if (r.drawingKey) {
        const t = thumb(r.drawingKey, state.settings.trace, 'static');
        if (r.bestDrawing) t.appendChild(el('span', 'badge', '🏆 Best drawing'));
        card.appendChild(t);
      } else card.appendChild(el('div', 'noimg', 'No drawing'));
      const meta = el('div', 'res-meta');
      const name = el('div', 'res-name');
      const dot = el('span', 'dot'); dot.style.background = r.color; name.appendChild(dot);
      name.appendChild(el('span', null, r.name));
      name.appendChild(el('span', 'gain' + (r.gained ? '' : ' zero'), '+' + r.gained));
      meta.appendChild(name);
      const l1 = el('div', 'res-line');
      l1.appendChild(document.createTextNode('Guessed: '));
      l1.appendChild(el('span', r.correct ? 'ok' : 'no', r.guess ? `${r.guess} ${r.correct ? '✓' : '✗'}` : '— ✗'));
      meta.appendChild(l1);
      meta.appendChild(el('div', 'res-line', `⭐ ${r.votes} vote${r.votes === 1 ? '' : 's'}`));
      card.appendChild(meta);
      gal.appendChild(card);
    }
  }
  $('#nextBtn').onclick = () => act('next').catch(() => { });
  $('#retryBtn').onclick = () => act('next').catch(() => { });
  $('#errLobbyBtn').onclick = () => act('lobby').catch(() => { });
  $('#skipBtn').onclick = () => act('skip').catch(() => { });
  $('#againBtn').onclick = () => act('start').catch(() => { });
  $('#toLobbyBtn').onclick = () => act('lobby').catch(() => { });
  $('#scoresBtn').onclick = () => $('#sidebar').classList.toggle('open');

  function renderFinal() {
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    const pod = $('#podium'); pod.innerHTML = '';
    const order = [1, 0, 2]; // 2nd, 1st, 3rd
    for (const i of order) {
      const p = ranked[i]; if (!p) continue;
      const d = el('div', 'pod p' + (i + 1));
      d.appendChild(el('div', 'pname', p.name));
      d.appendChild(el('div', 'pts', p.score + ' pts'));
      d.appendChild(el('div', 'bar', String(i + 1)));
      pod.appendChild(d);
    }
    const list = $('#finalList'); list.innerHTML = '';
    ranked.forEach(p => list.appendChild(el('li', null, `${p.name} — ${p.score} pts`)));
  }

  // ------------------------------------------------------------ timer
  function tick() {
    const t = $('#timer');
    if (!state || !state.endsAt || !['drawing', 'voting'].includes(state.phase)) { t.textContent = ''; t.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((state.endsAt - (Date.now() + clockOffset)) / 1000));
    t.textContent = left + 's';
    t.classList.toggle('low', left <= 10);
    // Auto-submit once when time runs out.
    if (state.phase === 'drawing' && left <= 0 && autoRound !== state.round) { autoRound = state.round; submitDrawing(); }
  }
  setInterval(tick, 250);
})();
