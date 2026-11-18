/* PokeSketch — client */
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
    try { return await api('/api/action', { ...session, type, ...extra }); }
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
    es.addEventListener('ops', ev => { try { onOps(JSON.parse(ev.data)); } catch (_) { } });
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
        if (state.sk && ['choosing', 'sketch'].includes(state.phase)) s = p.id === state.sk.drawerId ? '✏️' : (state.sk.guessed.includes(p.id) ? '✅' : '');
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
    $$('.mode').forEach(b => {
      b.classList.toggle('on', b.dataset.mode === s.mode);
      b.disabled = !host;
    });
    $('#blurSetting').classList.toggle('hidden', s.mode === 'sketch');
    $('#roundsNote').textContent = s.mode === 'sketch' ? 'everyone draws once per round' : '';
    loadNames(s.gens);
  }
  $$('.mode').forEach(b => b.onclick = () => act('settings', { settings: { mode: b.dataset.mode } }).catch(() => { }));
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
    history: [], drawing: false, last: null, dirty: false,
  };
  pad.ctx = pad.canvas.getContext('2d', { willReadFrequently: true });

  // The drawing layer is always transparent, so the blurred card can show through it
  // when Trace is on. The white background is added when the drawing is exported.
  function resetPad() {
    pad.canvas.width = 700;
    pad.canvas.height = 980;
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
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
      c.globalCompositeOperation = 'destination-out'; c.strokeStyle = '#000';
    } else c.strokeStyle = pad.color;
    c.lineWidth = pad.size * scale() * (pad.tool === 'eraser' ? 1.8 : 1);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pad.last.x, pad.last.y); c.lineTo(p.x, p.y); c.stroke();
    c.restore();
    pad.last = p;
  }
  const isSketch = () => !!(state && state.sk && state.settings.mode === 'sketch');
  const amDrawer = () => isSketch() && state.phase === 'sketch' && state.sk.drawerId === state.you;
  const locked = () => {
    if (!state) return true;
    if (isSketch()) return !amDrawer();
    return state.phase !== 'drawing' || submittedRound === state.round;
  };

  pad.canvas.addEventListener('pointerdown', e => {
    if (locked()) return;
    e.preventDefault();
    pad.canvas.setPointerCapture(e.pointerId);
    const p = posOf(e);
    if (isSketch()) {
      if (pad.tool === 'fill') { sendOp({ k: 'f', x: Math.floor(p.x), y: Math.floor(p.y), c: pad.color }); return; }
      pad.drawing = true;
      const er = pad.tool === 'eraser';
      sendOp({ k: 'b', x: r1(p.x), y: r1(p.y), w: r1(pad.size * scale() * (er ? 1.8 : 1)), e: er, c: pad.color });
      return;
    }
    snapshot();
    pad.version = (pad.version || 0) + 1;
    if (pad.tool === 'fill') { floodFill(Math.floor(p.x), Math.floor(p.y), pad.color); pad.dirty = true; return; }
    pad.drawing = true; pad.last = p; pad.dirty = true;
    strokeTo({ x: p.x + 0.01, y: p.y + 0.01 }); // a dot on tap
  });
  pad.canvas.addEventListener('pointermove', e => {
    if (!pad.drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (isSketch()) {
      const pts = [];
      for (const ev of (evs.length ? evs : [e])) { const q = posOf(ev); pts.push(r1(q.x), r1(q.y)); }
      sendOp({ k: 'm', p: pts });
      return;
    }
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
    x = Math.floor(x); y = Math.floor(y);
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
  let traceOn = false;
  try { traceOn = localStorage.getItem('ss-trace') === '1'; } catch (_) { }
  function applyTrace() {
    $('#stage').classList.toggle('show-trace', traceOn);
    $('#traceBtn').classList.toggle('active', traceOn);
  }
  $('#traceBtn').onclick = () => {
    traceOn = !traceOn; applyTrace();
    try { localStorage.setItem('ss-trace', traceOn ? '1' : '0'); } catch (_) { }
  };
  applyTrace();
  $('#undoBtn').onclick = () => { if (locked()) return; if (isSketch()) sendOp({ k: 'u' }); else undo(); };
  $('#clearBtn').onclick = () => {
    if (locked()) return;
    if (isSketch()) { sendOp({ k: 'x' }); return; }
    snapshot();
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  };
  document.addEventListener('keydown', e => {
    if (!state || !['drawing', 'sketch'].includes(state.phase) || e.target.tagName === 'INPUT' || locked()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#undoBtn').click(); }
    else if (e.key === 'b') setTool('brush');
    else if (e.key === 'f') setTool('fill');
    else if (e.key === 'e') setTool('eraser');
    else if (e.key === 't') $('#traceBtn').click();
  });


  // ------------------------------------------------------------ Sketch & Guess: live drawing
  // The drawer's strokes become small "ops" that are drawn locally, sent to the
  // server in batches, and replayed on everyone else's canvas.
  const r1 = v => Math.round(v * 10) / 10;
  const live = { turnNo: null, ops: [], cur: null, outbox: [], sending: false, fetching: false };

  function drawSeg(from, to, cur) {
    const c = pad.ctx;
    c.save();
    if (cur.e) c.globalCompositeOperation = 'destination-out';
    c.strokeStyle = cur.e ? '#000' : cur.c;
    c.lineWidth = cur.w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
    c.restore();
  }
  function applyOp(op) {
    if (op.k === 'b') {
      live.cur = { e: op.e, c: op.c, w: op.w, last: { x: op.x, y: op.y } };
      drawSeg(live.cur.last, { x: op.x + 0.01, y: op.y + 0.01 }, live.cur);
    } else if (op.k === 'm' && live.cur) {
      for (let i = 0; i < op.p.length; i += 2) {
        const p = { x: op.p[i], y: op.p[i + 1] };
        drawSeg(live.cur.last, p, live.cur); live.cur.last = p;
      }
    } else if (op.k === 'f') { live.cur = null; floodFill(op.x, op.y, op.c); }
    else if (op.k === 'x') { live.cur = null; pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height); }
    else if (op.k === 'u') { replay(live.ops); }
  }
  // Redraw from scratch, honouring undo: each stroke / fill / clear is one undo step.
  function replay(ops) {
    const groups = [];
    for (const op of ops) {
      if (op.k === 'm') { if (groups.length && groups[groups.length - 1][0].k === 'b') groups[groups.length - 1].push(op); }
      else if (op.k === 'u') groups.pop();
      else groups.push([op]);
    }
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    live.cur = null;
    for (const g of groups) for (const op of g) { if (op.k !== 'u') applyOp(op); }
    live.cur = null;
  }
  function sendOp(op) {
    live.ops.push(op);
    applyOp(op);
    const last = live.outbox[live.outbox.length - 1];
    if (op.k === 'm' && last && last.k === 'm' && last.p.length + op.p.length <= 600) last.p.push(...op.p);
    else live.outbox.push(op.k === 'm' ? { k: 'm', p: [...op.p] } : op);
  }
  async function flushOps() {
    if (live.sending || !live.outbox.length || !session || !amDrawer()) return;
    live.sending = true;
    const ops = live.outbox.splice(0, 400);
    try {
      await fetch('/api/draw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...session, turnNo: live.turnNo, ops }) });
    } catch (_) { live.outbox.unshift(...ops); }
    finally { live.sending = false; }
  }
  setInterval(flushOps, 60);

  async function fetchAllOps() {
    if (live.fetching || !session) return;
    live.fetching = true;
    try {
      const r = await fetch(`/api/ops?code=${session.code}&pid=${session.pid}&token=${session.token}`);
      const j = await r.json();
      if (j.turnNo === live.turnNo) { live.ops = j.ops || []; replay(live.ops); }
    } catch (_) { }
    finally { live.fetching = false; }
  }
  function onOps(msg) {
    if (!state || msg.turnNo !== live.turnNo || amDrawer()) return;
    if (msg.from !== live.ops.length) { fetchAllOps(); return; } // missed something: resync
    for (const op of msg.ops) { live.ops.push(op); applyOp(op); }
  }

  let chatKey = '';
  function renderChat() {
    const chat = state.sk.chat || [];
    const key = chat.length ? chat[chat.length - 1].id + ':' + chat.length : '0';
    if (key === chatKey) return;
    chatKey = key;
    const log = $('#chatLog'); log.innerHTML = '';
    for (const m of chat) {
      const d = el('div', 'msg' + (m.sys ? ' sys' : '') + (m.ok ? ' ok' : ''));
      if (m.sys) d.textContent = m.text;
      else { const b = el('b', null, m.name + ':'); b.style.color = m.color; d.appendChild(b); d.appendChild(document.createTextNode(m.text)); }
      log.appendChild(d);
    }
    log.scrollTop = log.scrollHeight;
  }
  function renderHint(text) {
    const box = $('#wpHint'); box.innerHTML = '';
    box.style.fontSize = text.length > 11 ? '17px' : text.length > 8 ? '21px' : '26px';
    for (const ch of text) {
      if (ch === ' ') box.appendChild(el('span', 'gap'));
      else box.appendChild(el('span', ch === '_' ? 'ch blank' : 'ch', ch === '_' ? '' : ch));
    }
  }

  function setRef(img, src) {
    if (!src) { img.classList.add('hidden'); img.removeAttribute('src'); return; }
    if (img.getAttribute('src') !== src) {
      img.onerror = () => img.classList.add('hidden');
      img.src = src;
    }
    img.classList.remove('hidden');
  }

  function setupSketch() {
    const sk = state.sk;
    const drawer = state.players.find(p => p.id === sk.drawerId);
    const dname = drawer ? drawer.name : 'Someone';
    const mine = sk.drawerId === state.you;
    if (live.turnNo !== sk.turnNo) {
      live.turnNo = sk.turnNo; live.ops = []; live.outbox = []; live.cur = null;
      resetPad(); setTool('brush');
      $('#chatInput').value = '';
      if (sk.opsLen > 0) fetchAllOps(); // joined or refreshed mid-turn
      loadNames(state.settings.gens);
    }
    $('.draw-layout').classList.toggle('viewer', !(mine && state.phase === 'sketch'));
    const got = sk.guessed.includes(state.you);
    if (state.phase === 'turnEnd') {
      $('#wpWho').textContent = 'It was';
      renderHint(sk.result.word);
      $('#wpSub').textContent = '';
    } else if (mine) {
      $('#wpWho').textContent = 'You are drawing';
      renderHint(sk.word || '');
      $('#wpSub').textContent = 'Use the card for reference. No letters or words!';
    } else {
      $('#wpWho').textContent = `${dname} is drawing`;
      renderHint(got && sk.word ? sk.word : (sk.hint || ''));
      $('#wpSub').textContent = got ? 'You got it! 🎉' : (sk.hint ? `${(sk.hint.match(/[\p{L}\p{N}_]/gu) || []).length} letters` : '');
    }
    // Reference pictures: official artwork right away, plus the real card once it loads.
    const showRef = state.card && (mine || state.phase === 'turnEnd');
    setRef($('#wpArt'), showRef ? state.card.art : null);
    setRef($('#wpCard'), showRef ? state.card.image : null);

    const input = $('#chatInput');
    const canGuess = state.phase === 'sketch' && !mine && !got;
    input.disabled = state.phase === 'sketch' && (mine || got);
    input.placeholder = mine && state.phase === 'sketch' ? "You're drawing. No hints!" : got ? 'You got it! 🎉' : 'Type your guess…';
    if (!canGuess && document.activeElement === input && input.disabled) input.blur();
    renderChat();

    const ov = $('#turnOverlay');
    if (state.phase === 'turnEnd' && sk.result) {
      const r = sk.result;
      ov.innerHTML = '';
      const box = el('div');
      box.appendChild(el('div', 'muted', 'It was…'));
      box.appendChild(el('h2', null, r.word));
      box.appendChild(el('div', null, `${r.drawerName} drew it: +${r.drawerGain}`));
      const ul = el('ul', 'to-rows');
      for (const row of r.rows) {
        const li = el('li', row.guessed ? '' : 'miss');
        const n = el('span', null, row.name); n.style.color = row.guessed ? row.color : '';
        li.appendChild(n); li.appendChild(el('span', null, row.guessed ? `+${row.points}` : 'missed'));
        ul.appendChild(li);
      }
      box.appendChild(ul);
      box.appendChild(el('div', 'muted', r.isLast ? 'Final scores next…' : 'Next turn starting…'));
      ov.appendChild(box);
      ov.classList.remove('hidden');
    } else ov.classList.add('hidden');
    $('#lockedOverlay').classList.add('hidden');
  }
  $('#chatInput').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    e.target.value = '';
    try {
      const r = await act('guess', { text });
      if (r && r.correct) toast(`You got it! +${r.points}`, 2000);
      else if (r && r.close) toast(`“${text}” is so close!`, 2000);
    } catch (_) { }
  });

  function renderChoose() {
    const sk = state.sk;
    const mine = sk.drawerId === state.you;
    $('#chooseMine').classList.toggle('hidden', !mine);
    $('#chooseWait').classList.toggle('hidden', mine);
    if (mine) {
      const box = $('#choices');
      const key = sk.turnNo + ':' + (sk.choices || []).join('|');
      if (box.dataset.key !== key) {
        box.dataset.key = key; box.innerHTML = '';
        (sk.choices || []).forEach((name, i) => {
          const b = el('button', 'choice', name);
          b.onclick = () => act('choose', { index: i }).catch(() => { });
          box.appendChild(b);
        });
      }
    } else {
      const d = state.players.find(p => p.id === sk.drawerId);
      $('#chooseWho').textContent = `${d ? d.name : 'Someone'} is picking a Pokémon…`;
    }
  }

  // ------------------------------------------------------------ game views
  let drawRoundKey = null;     // which round the drawing view was set up for
  let submittedRound = -1;
  let submitting = false;
  let autoRound = -1;

  function showView(id) { $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== id)); }

  function renderGame() {
    document.body.classList.toggle('mode-sketch', isSketch());
    let pill = state.phase === 'final' ? 'Game over' : `Round ${Math.max(1, state.round)}/${state.totalRounds}`;
    if (isSketch() && state.phase !== 'final') pill += ` · Turn ${state.sk.turn}/${state.sk.turns}`;
    $('#roundPill').textContent = pill;
    renderPlayers($('#scoreList'), { byScore: true, status: true });
    $('#skipBtn').classList.toggle('hidden', !['drawing', 'voting', 'choosing', 'sketch', 'turnEnd'].includes(state.phase));
    switch (state.phase) {
      case 'loading': showView('v-loading'); break;
      case 'error': showView('v-error'); $('#errorText').textContent = state.error || ''; break;
      case 'drawing': showView('v-draw'); setupDraw(); break;
      case 'voting': showView('v-vote'); renderVote(); break;
      case 'results': showView('v-results'); renderResults(); break;
      case 'final': showView('v-final'); renderFinal(); break;
      case 'choosing': showView('v-choose'); renderChoose(); break;
      case 'sketch': case 'turnEnd': showView('v-draw'); setupSketch(); break;
    }
    tick();
  }

  function setupDraw() {
    const key = state.code + ':' + state.gameId + ':' + state.round + ':' + state.card.image;
    if (drawRoundKey !== key) {
      drawRoundKey = key; live.turnNo = null;
      submitting = false; submittedRound = -1; autoRound = -1; disarm();
      resetPad();
      setTool('brush');
      $('#guessInput').value = '';
      $('.draw-layout').classList.remove('viewer');
      $('#turnOverlay').classList.add('hidden');
      blurredInto($('#refCanvas'));
      blurredInto($('#bgCanvas'));
      loadNames(state.settings.gens);
    }
    if (state.mySubmitted) submittedRound = state.round;
    const isLocked = submittedRound === state.round;
    $('#lockedOverlay').classList.toggle('hidden', !isLocked);
    $('#doneBtn').disabled = isLocked;
    if (isLocked) $('#doneBtn').textContent = 'Locked in ✓';
    else if (!armTimer) $('#doneBtn').textContent = 'Lock it in';
    $('#guessInput').disabled = isLocked;
  }

  function exportDrawing() {
    // Downscale a bit to keep uploads small.
    const s = 0.72;
    const c = document.createElement('canvas');
    c.width = Math.round(pad.canvas.width * s); c.height = Math.round(pad.canvas.height * s);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); // plain white background
    x.imageSmoothingQuality = 'high';
    x.drawImage(pad.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  // Autosave: every few seconds, quietly send the current drawing + guess so nothing
  // is lost if this player never taps Lock it in (phone locks, app switch, slow upload).
  let draftSaved = '';
  let drafting = false;
  async function saveDraft() {
    if (!state || !session || isSketch() || state.phase !== 'drawing' || submittedRound === state.round || submitting || drafting) return;
    const guess = $('#guessInput').value.trim();
    const key = state.round + ':' + (pad.version || 0) + ':' + guess;
    if (key === draftSaved || (!pad.dirty && !guess)) return;
    drafting = true;
    try {
      await api('/api/action', { ...session, type: 'draft', round: state.round, guess, blank: !pad.dirty, drawing: pad.dirty ? exportDrawing() : null });
      draftSaved = key;
    } catch (_) { /* try again next tick */ }
    finally { drafting = false; }
  }
  setInterval(saveDraft, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
  $('#undoBtn').addEventListener('click', () => { pad.version = (pad.version || 0) + 1; });
  $('#clearBtn').addEventListener('click', () => { pad.version = (pad.version || 0) + 1; });

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
  // Two taps to lock in, so nobody submits by accident.
  let armTimer = null;
  function disarm() {
    clearTimeout(armTimer); armTimer = null;
    const b = $('#doneBtn'); b.classList.remove('armed');
    if (!b.disabled) b.textContent = 'Lock it in';
  }
  $('#doneBtn').onclick = () => {
    if (locked()) return;
    if (!armTimer) {
      const b = $('#doneBtn'); b.classList.add('armed'); b.textContent = 'Tap again to lock in';
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    submitDrawing();
  };
  // Enter just saves the guess; it never submits the drawing.
  $('#guessInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); toast('Guess saved. Keep drawing!', 1500); }
  });

  function thumb(key, extraCls = '') {
    const t = el('div', 'thumb' + (extraCls ? ' ' + extraCls : ''));
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
        const t = thumb(g.key, g.mine ? 'mine' : '');
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
        const t = thumb(r.drawingKey, 'static');
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
    if (!state || !state.endsAt || !['drawing', 'voting', 'choosing', 'sketch', 'turnEnd'].includes(state.phase)) { t.textContent = ''; t.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((state.endsAt - (Date.now() + clockOffset)) / 1000));
    t.textContent = left + 's';
    t.classList.toggle('low', left <= 10 && state.phase !== 'turnEnd');
    // Auto-submit once when time runs out.
    if (state.phase === 'drawing' && left <= 0 && autoRound !== state.round) { autoRound = state.round; submitDrawing(); }
  }
  setInterval(tick, 250);
})();
