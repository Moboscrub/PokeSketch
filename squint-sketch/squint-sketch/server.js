// Squint & Sketch — blurred Pokémon card drawing party game
// Zero dependencies. Requires Node 18+ (uses built-in fetch).
// Run:  node server.js        (then open http://localhost:3000)
// Env:  PORT=3000  POKEMONTCG_API_KEY=xxxx (optional, raises rate limits)  MOCK=1 (offline test cards)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.POKEMONTCG_API_KEY || '';
const MOCK = process.env.MOCK === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SPECIES_CACHE = path.join(__dirname, 'species-cache.json');

const GENS = {
  1: [1, 151], 2: [152, 251], 3: [252, 386], 4: [387, 493], 5: [494, 649],
  6: [650, 721], 7: [722, 809], 8: [810, 905], 9: [906, 1025],
};

// ---------------------------------------------------------------- species names
// species[dex] = { slug: 'mr-mime', display: 'Mr. Mime' }
let species = [];
const SPECIAL_NAMES = {
  'mr-mime': 'Mr. Mime', 'mime-jr': 'Mime Jr.', 'mr-rime': 'Mr. Rime',
  'nidoran-f': 'Nidoran♀', 'nidoran-m': 'Nidoran♂', farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd", 'ho-oh': 'Ho-Oh', 'porygon-z': 'Porygon-Z',
  'type-null': 'Type: Null', 'jangmo-o': 'Jangmo-o', 'hakamo-o': 'Hakamo-o',
  'kommo-o': 'Kommo-o', flabebe: 'Flabébé', 'chi-yu': 'Chi-Yu',
  'chien-pao': 'Chien-Pao', 'ting-lu': 'Ting-Lu', 'wo-chien': 'Wo-Chien',
};
function prettySpecies(slug) {
  if (SPECIAL_NAMES[slug]) return SPECIAL_NAMES[slug];
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function setSpecies(list) {
  species = [];
  list.forEach((slug, i) => { species[i + 1] = { slug, display: prettySpecies(slug) }; });
}
async function loadSpecies() {
  try {
    const cached = JSON.parse(fs.readFileSync(SPECIES_CACHE, 'utf8'));
    if (Array.isArray(cached) && cached.length > 900) { setSpecies(cached); return; }
  } catch (_) { /* no cache yet */ }
  if (MOCK) return;
  try {
    const r = await fetch('https://pokeapi.co/api/v2/pokemon-species?limit=1025', { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    // The list is ordered by id; read the id from each URL to be safe.
    const slugs = [];
    for (const s of j.results) {
      const id = Number(s.url.replace(/\/$/, '').split('/').pop());
      if (id >= 1 && id <= 1025) slugs[id - 1] = s.name;
    }
    setSpecies(slugs);
    fs.writeFileSync(SPECIES_CACHE, JSON.stringify(slugs));
    console.log(`Loaded ${slugs.length} Pokémon names.`);
  } catch (e) {
    console.warn('Could not load Pokémon names from PokeAPI (guessing still works off card names):', e.message);
  }
}

// ---------------------------------------------------------------- answer matching
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/♀/g, 'f').replace(/♂/g, 'm')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
const CARD_NAME_JUNK = /\b(ex|gx|v|vmax|vstar|v-union|break|lv\.?\s*x|prime|legend|star|δ|delta|dark|light|shining|radiant|alolan|galarian|hisuian|paldean|mega|m|primal|tera|origin|forme?|crowned|shadow|sp|fb|gl|c|g|4|tag|team)\b|★|◇|\b\w+'s\b/gi;
function cardNameCandidates(cardName) {
  const out = new Set();
  for (const part of String(cardName).split(/&|\band\b/i)) {
    const stripped = part.replace(CARD_NAME_JUNK, ' ').replace(/\s+/g, ' ').trim();
    if (stripped) out.add(norm(stripped));
  }
  return out;
}
function buildAnswers(card) {
  const set = new Set();
  for (const n of card.dexNums) {
    const sp = species[n];
    if (sp) {
      set.add(norm(sp.slug));
      set.add(norm(sp.display));
      if (/^nidoran-[fm]$/.test(sp.slug)) set.add('nidoran');
    }
  }
  for (const c of cardNameCandidates(card.name)) set.add(c);
  set.delete('');
  return [...set];
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    // Swapped neighbours ("sycther") count as one typo.
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
function isCorrect(guess, answers) {
  const g = norm(guess);
  if (!g) return false;
  return answers.some(a => {
    if (a === g) return true;
    // Forgive small typos on longer names.
    if (a.length >= 8) return lev(a, g) <= 2;
    if (a.length >= 5) return lev(a, g) <= 1;
    return false;
  });
}

// ---------------------------------------------------------------- card picking
function mockCard(dex) {
  const names = ['Bulbasaur', 'Pikachu', 'Scyther', 'Psyduck', 'Gengar', 'Eevee'];
  const name = names[dex % names.length];
  const hue = (dex * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="367" height="512" viewBox="0 0 367 512">
<rect width="367" height="512" rx="18" fill="#f2d33a"/><rect x="18" y="18" width="331" height="476" rx="10" fill="hsl(${hue},55%,60%)"/>
<rect x="34" y="60" width="299" height="200" fill="hsl(${(hue + 120) % 360},45%,40%)"/><circle cx="183" cy="160" r="70" fill="hsl(${(hue + 200) % 360},70%,65%)"/>
<text x="34" y="48" font-size="26" font-family="sans-serif" font-weight="bold" fill="#222">${name}</text>
<rect x="34" y="290" width="299" height="170" rx="6" fill="rgba(255,255,255,.55)"/></svg>`;
  return {
    id: 'mock-' + dex, name, dexNums: [dex], set: 'Mock Set',
    image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
  };
}
async function fetchCardsForDex(dex) {
  const url = 'https://api.pokemontcg.io/v2/cards?' + new URLSearchParams({
    q: `nationalPokedexNumbers:${dex}`,
    pageSize: '250',
    select: 'id,name,images,nationalPokedexNumbers,set',
  });
  const r = await fetch(url, {
    headers: API_KEY ? { 'X-Api-Key': API_KEY } : {},
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Pokémon TCG API answered ${r.status}`);
  const j = await r.json();
  return (j.data || []).filter(c => c.images && (c.images.large || c.images.small));
}
function randomDexFrom(gens, avoid) {
  const pool = [];
  for (const g of gens) {
    const [a, b] = GENS[g] || [];
    if (!a) continue;
    for (let n = a; n <= b; n++) if (!avoid.has(n)) pool.push(n);
  }
  if (!pool.length) { avoid.clear(); return randomDexFrom(gens, avoid); }
  return pool[Math.floor(Math.random() * pool.length)];
}
async function pickCard(gens, avoid) {
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const dex = randomDexFrom(gens, avoid);
    avoid.add(dex);
    if (MOCK) return mockCard(dex);
    try {
      const cards = await fetchCardsForDex(dex);
      if (!cards.length) continue; // some brand-new Pokémon have no cards yet
      const c = cards[Math.floor(Math.random() * cards.length)];
      return {
        id: c.id, name: c.name, set: c.set ? c.set.name : '',
        dexNums: c.nationalPokedexNumbers && c.nationalPokedexNumbers.length ? c.nationalPokedexNumbers : [dex],
        image: c.images.large || c.images.small,
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Could not find a card for those generations.');
}

// ---------------------------------------------------------------- rooms
const rooms = new Map();
const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); }
  while (rooms.has(c));
  return c;
}
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#a3a3a3', '#84cc16', '#f43f5e'];

function createRoom() {
  const room = {
    code: newCode(), hostId: null, players: new Map(), subs: new Map(),
    settings: { gens: [1, 2, 3, 4, 5, 6, 7, 8, 9], rounds: 5, drawTime: 90, voteTime: 40, blur: 'medium', trace: true },
    phase: 'lobby', round: 0, card: null, answers: [], endsAt: 0, timer: null,
    submissions: new Map(), votes: new Map(), keys: new Map(), results: null,
    usedDex: new Set(), error: null, lastActive: Date.now(), loadingToken: 0,
  };
  rooms.set(room.code, room);
  return room;
}
function addPlayer(room, name) {
  const id = rid(8);
  const color = COLORS[room.players.size % COLORS.length];
  const p = { id, token: rid(16), name, color, score: 0, connected: false, joinedAt: Date.now(), lastSeen: Date.now() };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  return p;
}
const connectedPlayers = room => [...room.players.values()].filter(p => p.connected);

function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Trainer';
}

function publicState(room, pid) {
  const now = Date.now();
  const s = {
    code: room.code, gameId: room.gameId || 0, you: pid, hostId: room.hostId, phase: room.phase,
    round: room.round, totalRounds: room.settings.rounds, settings: room.settings,
    serverNow: now, endsAt: room.endsAt, error: room.error,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, score: p.score, connected: p.connected,
      submitted: room.submissions.has(p.id), voted: room.votes.has(p.id),
    })),
  };
  if (['drawing', 'voting'].includes(room.phase) && room.card) {
    s.card = { image: room.card.image }; // no name until results
  }
  if (room.phase === 'drawing') {
    const mine = room.submissions.get(pid);
    s.mySubmitted = !!mine;
  }
  if (room.phase === 'voting') {
    s.gallery = [...room.keys.entries()].map(([key, owner]) => ({ key, mine: owner === pid }));
    s.myVote = room.votes.get(pid) || null;
    const mine = room.submissions.get(pid);
    s.myGuess = mine ? mine.guess : '';
  }
  if ((room.phase === 'results' || room.phase === 'final') && room.card) {
    s.card = { image: room.card.image, name: room.card.display, cardName: room.card.name, set: room.card.set };
    s.results = room.results;
  }
  return s;
}
function send(res, obj) { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) { } }
function broadcast(room) {
  room.lastActive = Date.now();
  for (const [pid, set] of room.subs) {
    const st = publicState(room, pid);
    for (const res of set) send(res, st);
  }
}
function clearTimer(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }

async function startRound(room) {
  clearTimer(room);
  room.round += 1;
  if (room.round > room.settings.rounds) { room.phase = 'final'; room.endsAt = 0; broadcast(room); return; }
  room.phase = 'loading'; room.error = null; room.endsAt = 0;
  room.submissions = new Map(); room.votes = new Map(); room.keys = new Map(); room.results = null; room.card = null;
  broadcast(room);
  const token = ++room.loadingToken;
  try {
    const card = await pickCard(room.settings.gens, room.usedDex);
    if (token !== room.loadingToken || room.phase !== 'loading') return;
    card.display = species[card.dexNums[0]] ? species[card.dexNums[0]].display : card.name;
    room.card = card;
    room.answers = buildAnswers(card);
    room.phase = 'drawing';
    room.endsAt = Date.now() + room.settings.drawTime * 1000;
    // Small grace period so last-second uploads make it in.
    room.timer = setTimeout(() => endDrawing(room), room.settings.drawTime * 1000 + 3500);
    broadcast(room);
  } catch (e) {
    if (token !== room.loadingToken) return;
    console.warn('Card fetch failed:', e.message);
    room.round -= 1;
    room.phase = 'error';
    room.error = 'Could not get a card from the Pokémon TCG API (' + e.message + '). It is sometimes slow; try again.';
    broadcast(room);
  }
}
function endDrawing(room) {
  if (room.phase !== 'drawing') return;
  clearTimer(room);
  // Every drawn picture gets an anonymous key for voting.
  const entries = [...room.submissions.entries()].filter(([, s]) => s.drawing);
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
  room.keys = new Map(entries.map(([pid]) => [rid(6), pid]));
  if (room.keys.size < 2) { finishRound(room); return; }
  room.phase = 'voting';
  room.endsAt = Date.now() + room.settings.voteTime * 1000;
  room.timer = setTimeout(() => finishRound(room), room.settings.voteTime * 1000 + 1500);
  broadcast(room);
}
function maybeEndVoting(room) {
  const owners = new Set(room.keys.values());
  const voters = connectedPlayers(room).filter(p => {
    // Someone can vote if there is at least one drawing that is not theirs.
    return [...owners].some(o => o !== p.id);
  });
  if (voters.every(p => room.votes.has(p.id))) finishRound(room);
}
function finishRound(room) {
  if (!['drawing', 'voting'].includes(room.phase)) return;
  clearTimer(room);
  const tally = new Map();
  for (const key of room.votes.values()) {
    const owner = room.keys.get(key);
    if (owner) tally.set(owner, (tally.get(owner) || 0) + 1);
  }
  const maxVotes = Math.max(0, ...tally.values());
  const keyByOwner = new Map([...room.keys.entries()].map(([k, o]) => [o, k]));
  const rows = [];
  for (const p of room.players.values()) {
    const sub = room.submissions.get(p.id);
    const correct = !!(sub && sub.correct);
    const votes = tally.get(p.id) || 0;
    const bestDrawing = maxVotes > 0 && votes === maxVotes;
    const gained = (correct ? 1 : 0) + (bestDrawing ? 1 : 0);
    p.score += gained;
    rows.push({
      playerId: p.id, name: p.name, color: p.color,
      guess: sub ? sub.guess : '', correct, votes, bestDrawing, gained,
      drawingKey: keyByOwner.get(p.id) || (sub && sub.drawing ? 'own-' + p.id : null),
    });
  }
  // Drawings that skipped voting (fewer than 2) still need a key to display.
  for (const r of rows) if (r.drawingKey && r.drawingKey.startsWith('own-')) {
    const k = rid(6); room.keys.set(k, r.playerId); r.drawingKey = k;
  }
  rows.sort((a, b) => b.votes - a.votes || Number(b.correct) - Number(a.correct));
  room.results = { rows, maxVotes, isLast: room.round >= room.settings.rounds };
  room.phase = 'results';
  room.endsAt = 0;
  broadcast(room);
}

// ---------------------------------------------------------------- http helpers
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function auth(body) {
  const room = rooms.get(String(body.code || '').toUpperCase());
  if (!room) return {};
  const p = room.players.get(body.pid);
  if (!p || p.token !== body.token) return { room };
  return { room, p };
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------------------------------------------------------------- actions
function handleAction(room, p, body) {
  const isHost = room.hostId === p.id;
  switch (body.type) {
    case 'settings': {
      if (!isHost || room.phase !== 'lobby') return 'Only the host can change settings in the lobby.';
      const s = body.settings || {};
      const st = room.settings;
      if (Array.isArray(s.gens)) {
        const g = [...new Set(s.gens.map(Number).filter(n => GENS[n]))].sort((a, b) => a - b);
        if (g.length) st.gens = g;
      }
      if ([3, 5, 8, 10].includes(Number(s.rounds))) st.rounds = Number(s.rounds);
      if ([45, 60, 90, 120, 180].includes(Number(s.drawTime))) st.drawTime = Number(s.drawTime);
      if (['light', 'medium', 'heavy', 'brutal'].includes(s.blur)) st.blur = s.blur;
      if (typeof s.trace === 'boolean') st.trace = s.trace;
      room.usedDex.clear();
      broadcast(room); return null;
    }
    case 'start': {
      if (!isHost) return 'Only the host can start.';
      if (!['lobby', 'final'].includes(room.phase)) return 'Game already running.';
      for (const pl of room.players.values()) pl.score = 0;
      room.round = 0; room.gameId = (room.gameId || 0) + 1;
      startRound(room); return null;
    }
    case 'next': {
      if (!isHost) return 'Only the host can continue.';
      if (room.phase === 'results' || room.phase === 'error') { startRound(room); return null; }
      return 'Not now.';
    }
    case 'lobby': {
      if (!isHost) return 'Only the host can do that.';
      clearTimer(room); room.loadingToken++;
      room.phase = 'lobby'; room.round = 0; room.card = null; room.results = null; room.error = null; room.endsAt = 0;
      room.submissions = new Map(); room.votes = new Map(); room.keys = new Map();
      for (const pl of room.players.values()) pl.score = 0;
      broadcast(room); return null;
    }
    case 'skip': {
      if (!isHost) return 'Only the host can do that.';
      if (room.phase === 'drawing') endDrawing(room);
      else if (room.phase === 'voting') finishRound(room);
      return null;
    }
    case 'submit': {
      if (room.phase !== 'drawing' || Number(body.round) !== room.round) return 'Drawing time is over.';
      const guess = String(body.guess || '').slice(0, 40);
      let drawing = null;
      if (!body.blank && typeof body.drawing === 'string' && body.drawing.startsWith('data:image/png;base64,')) {
        const buf = Buffer.from(body.drawing.slice(22), 'base64');
        if (buf.length < 4 * 1024 * 1024 && buf.slice(0, 4).toString('hex') === '89504e47') drawing = buf;
      }
      room.submissions.set(p.id, { guess, drawing, correct: isCorrect(guess, room.answers) });
      broadcast(room);
      const everyone = connectedPlayers(room);
      if (everyone.length && everyone.every(pl => room.submissions.has(pl.id))) endDrawing(room);
      return null;
    }
    case 'vote': {
      if (room.phase !== 'voting') return 'Voting is closed.';
      const owner = room.keys.get(body.key);
      if (!owner) return 'Unknown drawing.';
      if (owner === p.id) return "You can't vote for your own drawing.";
      room.votes.set(p.id, body.key);
      broadcast(room);
      maybeEndVoting(room);
      return null;
    }
    case 'kick': {
      if (!isHost || body.target === p.id) return 'Not allowed.';
      const t = room.players.get(body.target);
      if (!t) return null;
      room.players.delete(t.id);
      const subs = room.subs.get(t.id);
      if (subs) { for (const r of subs) { send(r, { kicked: true }); try { r.end(); } catch (_) { } } room.subs.delete(t.id); }
      broadcast(room); return null;
    }
    case 'leave': {
      room.players.delete(p.id);
      if (room.hostId === p.id) { const next = connectedPlayers(room)[0] || [...room.players.values()][0]; room.hostId = next ? next.id : null; }
      if (!room.players.size) { clearTimer(room); rooms.delete(room.code); return null; }
      broadcast(room); return null;
    }
    default: return 'Unknown action.';
  }
}

function onDisconnect(room, p) {
  p.connected = false; p.lastSeen = Date.now();
  broadcast(room);
  setTimeout(() => {
    if (!rooms.has(room.code) || p.connected || !room.players.has(p.id)) return;
    // In the lobby, people who closed the tab drop out of the list.
    if (room.phase === 'lobby') room.players.delete(p.id);
    if (room.hostId === p.id || !room.players.has(room.hostId)) {
      const next = connectedPlayers(room)[0];
      if (next) room.hostId = next.id;
    }
    if (room.phase === 'drawing') {
      const everyone = connectedPlayers(room);
      if (everyone.length && everyone.every(pl => room.submissions.has(pl.id))) endDrawing(room);
    }
    if (room.phase === 'voting') maybeEndVoting(room);
    broadcast(room);
  }, 15000);
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'POST' && p === '/api/create') {
      const body = await readBody(req, 10000);
      const room = createRoom();
      const pl = addPlayer(room, cleanName(body.name));
      return json(res, 200, { code: room.code, pid: pl.id, token: pl.token });
    }
    if (req.method === 'POST' && p === '/api/join') {
      const body = await readBody(req, 10000);
      const room = rooms.get(String(body.code || '').toUpperCase().trim());
      if (!room) return json(res, 404, { error: 'No room with that code.' });
      const existing = room.players.get(body.pid);
      if (existing && existing.token === body.token) return json(res, 200, { code: room.code, pid: existing.id, token: existing.token });
      if (room.players.size >= 16) return json(res, 400, { error: 'Room is full (16 players).' });
      const pl = addPlayer(room, cleanName(body.name));
      broadcast(room);
      return json(res, 200, { code: room.code, pid: pl.id, token: pl.token });
    }
    if (req.method === 'GET' && p === '/api/events') {
      const q = Object.fromEntries(url.searchParams);
      const { room, p: pl } = auth(q);
      if (!pl) return json(res, 403, { error: 'Not in this room.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      if (!room.subs.has(pl.id)) room.subs.set(pl.id, new Set());
      room.subs.get(pl.id).add(res);
      pl.connected = true; pl.lastSeen = Date.now();
      if (!room.players.has(room.hostId)) room.hostId = pl.id;
      broadcast(room);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { } }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        const set = room.subs.get(pl.id);
        if (set) { set.delete(res); if (!set.size) { room.subs.delete(pl.id); if (room.players.has(pl.id)) onDisconnect(room, pl); } }
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/action') {
      const body = await readBody(req);
      const { room, p: pl } = auth(body);
      if (!pl) return json(res, 403, { error: 'Not in this room.' });
      const err = handleAction(room, pl, body);
      return json(res, err ? 400 : 200, err ? { error: err } : { ok: true });
    }
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/api\/drawing\/([A-Z]{4})\/([\w-]+)$/))) {
      const room = rooms.get(m[1]);
      const owner = room && room.keys.get(m[2]);
      const sub = owner && room.submissions.get(owner);
      if (!sub || !sub.drawing) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
      return res.end(sub.drawing);
    }
    if (req.method === 'GET' && p === '/api/names') {
      const gens = String(url.searchParams.get('gens') || '').split(',').map(Number).filter(n => GENS[n]);
      const names = [];
      for (const g of (gens.length ? gens : Object.keys(GENS).map(Number))) {
        const [a, b] = GENS[g];
        for (let n = a; n <= b; n++) if (species[n]) names.push(species[n].display);
      }
      return json(res, 200, { names });
    }
    if (req.method === 'GET') {
      let file = p === '/' ? '/index.html' : p;
      const full = path.normalize(path.join(PUBLIC_DIR, file));
      if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      return fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    }
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 400, { error: 'Bad request.' });
  }
});

// Drop rooms nobody has touched for 3 hours.
setInterval(() => {
  const cutoff = Date.now() - 3 * 3600 * 1000;
  for (const [code, room] of rooms) if (room.lastActive < cutoff && !room.subs.size) { clearTimer(room); rooms.delete(code); }
}, 10 * 60 * 1000);

loadSpecies();
server.listen(PORT, () => {
  console.log(`Squint & Sketch running at http://localhost:${PORT}${MOCK ? '  (MOCK cards)' : ''}`);
});
