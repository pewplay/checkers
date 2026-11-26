// ================================================================
//  CHECKERS — PewPlay
//  @bg #2a1a10
//  @accent #e8553e
//  8×8, cattura obbligatoria, salti multipli, dame che muovono in tutte
//  le direzioni. Contro il computer (minimax) o in due.
// ================================================================
(function () {
  'use strict';
  const { clamp, sfx, store } = PP;

  const GAME_ID = 'checkers';
  const MODES = ['vs Computer', '2 Players'];
  const LEVELS = ['Easy', 'Medium', 'Hard'];
  const DEPTH = [1, 4, 7];
  // pezzi: 1 = rosso (giocatore, in basso), 2 = scuro; +2 = dama (3, 4)
  const own = (v, p) => v && ((v - 1) % 2) + 1 === p;
  const isKing = v => v > 2;

  let mode = 0, level = 1;
  let board, turn, selected, legal, anim, winner, lastMove, aiTimer, history, noCaptureMoves;
  let geo = { x: 0, y: 0, cell: 60 };
  let stats = { w: 0, l: 0 };

  function layout() {
    const top = 66, bottom = 20;
    const cell = Math.floor(Math.min((PP.W - 20) / 8, (PP.H - top - bottom) / 8));
    geo = { cell, x: (PP.W - cell * 8) / 2, y: top + (PP.H - top - bottom - cell * 8) / 2 };
  }

  function newBoard() {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) { if (r < 3) b[r][c] = 2; else if (r > 4) b[r][c] = 1; }
    return b;
  }

  // ── MOSSE ───────────────────────────────────────
  function dirsFor(v) {
    if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return v === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  }
  function jumpsFrom(b, r, c, v, path, captured, out) {
    let found = false;
    for (const [dr, dc] of dirsFor(v)) {
      const mr = r + dr, mc = c + dc, tr = r + dr * 2, tc = c + dc * 2;
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
      const mid = b[mr][mc];
      if (!mid || own(mid, ((v - 1) % 2) + 1) || b[tr][tc] || captured.some(([a, bb]) => a === mr && bb === mc)) continue;
      found = true;
      // promozione: il salto si ferma
      const promote = !isKing(v) && ((v === 1 && tr === 0) || (v === 2 && tr === 7));
      const nb = b; const saved = nb[r][c]; nb[r][c] = 0;
      const np = path.concat([[tr, tc]]), nc = captured.concat([[mr, mc]]);
      if (promote) out.push({ path: np, caps: nc });
      else { nb[tr][tc] = v; if (!jumpsFrom(nb, tr, tc, v, np, nc, out)) out.push({ path: np, caps: nc }); nb[tr][tc] = 0; }
      nb[r][c] = saved;
    }
    return found;
  }
  function allMoves(b, p) {
    const jumps = [], steps = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = b[r][c];
      if (!own(v, p)) continue;
      const js = [];
      jumpsFrom(b, r, c, v, [[r, c]], [], js);
      jumps.push(...js);
      if (!jumps.length) for (const [dr, dc] of dirsFor(v)) {
        const tr = r + dr, tc = c + dc;
        if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && !b[tr][tc]) steps.push({ path: [[r, c], [tr, tc]], caps: [] });
      }
    }
    return jumps.length ? jumps : steps;
  }
  function apply(b, m) {
    const [fr, fc] = m.path[0], [tr, tc] = m.path[m.path.length - 1];
    let v = b[fr][fc];
    b[fr][fc] = 0;
    for (const [r, c] of m.caps) b[r][c] = 0;
    if (v === 1 && tr === 0) v = 3;
    if (v === 2 && tr === 7) v = 4;
    b[tr][tc] = v;
    return b;
  }

  // ── IA ──────────────────────────────────────────
  function evalBoard(b) {
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = b[r][c]; if (!v) continue;
      let val = isKing(v) ? 175 : 100;
      if (!isKing(v)) val += (v === 2 ? r : 7 - r) * 4;          // avanzare
      if (c >= 2 && c <= 5 && r >= 2 && r <= 5) val += 6;         // centro
      if (!isKing(v) && ((v === 2 && r === 0) || (v === 1 && r === 7))) val += 8; // difesa ultima fila
      s += own(v, 2) ? val : -val;
    }
    return s;
  }
  function minimax(b, depth, alpha, beta, p) {
    const moves = allMoves(b, p);
    if (!moves.length) return p === 2 ? -10000 - depth : 10000 + depth;
    if (depth <= 0 && !moves[0].caps.length) return evalBoard(b);
    if (depth <= -4) return evalBoard(b);
    let best = p === 2 ? -Infinity : Infinity;
    for (const m of moves) {
      const nb = apply(b.map(r => r.slice()), m);
      const v = minimax(nb, depth - 1, alpha, beta, 3 - p);
      if (p === 2) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
      else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (beta <= alpha) break;
    }
    return best;
  }
  function aiMove() {
    const moves = PP.shuffle(allMoves(board, 2));
    if (level === 0 && Math.random() < 0.4) return moves[0];
    let best = moves[0], bv = -Infinity;
    for (const m of moves) {
      const v = minimax(apply(board.map(r => r.slice()), m), DEPTH[level] - 1, -Infinity, Infinity, 1) + Math.random() * 3;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  }

  // ── FLUSSO ──────────────────────────────────────
  function start() {
    layout();
    board = newBoard();
    turn = 1; selected = null; legal = allMoves(board, 1); anim = null; winner = 0; lastMove = null; aiTimer = 0; history = []; noCaptureMoves = 0;
  }

  function doMove(m) {
    history.push(board.map(r => r.slice()));
    const v = board[m.path[0][0]][m.path[0][1]];
    anim = { m, v, i: 0, t: 0 };
    selected = null;
    sfx.tone(m.caps.length ? 330 : 520, 0.07, 'triangle', 0.12);
  }

  function finishMove() {
    const { m } = anim;
    const before = board[m.path[0][0]][m.path[0][1]];
    apply(board, m);
    const [tr, tc] = m.path[m.path.length - 1];
    if (!isKing(before) && isKing(board[tr][tc])) {
      PP.burst(geo.x + (tc + 0.5) * geo.cell, geo.y + (tr + 0.5) * geo.cell, ['#ffd54a', '#fff'], 24, 220, 4, 0.9, 200);
      sfx.chord([660, 880, 1320], 0.18, 'triangle', 0.12, 0.05);
    }
    noCaptureMoves = m.caps.length ? 0 : noCaptureMoves + 1;
    lastMove = m;
    anim = null;
    turn = 3 - turn;
    legal = allMoves(board, turn);
    if (!legal.length) return end(3 - turn);
    if (noCaptureMoves >= 80) return end(3);
    if (mode === 0 && turn === 2) aiTimer = 0.45;
  }

  function end(w) {
    winner = w;
    if (mode === 0 && w !== 3) { if (w === 1) stats.w++; else stats.l++; store.set(`stats-${level}`, stats); }
    if (w === 1 || mode === 1) sfx.win(); else sfx.lose();
    const title = w === 3 ? 'Draw' : mode === 1 ? `${w === 1 ? 'Red' : 'Dark'} wins!` : w === 1 ? 'You win!' : 'Computer wins';
    PP.over(title, mode === 0 ? `${LEVELS[level]} · Wins ${stats.w} · Losses ${stats.l}` : 'Good game!');
  }

  function update(dt) {
    if (anim) {
      anim.t += dt * 7;
      if (anim.t >= 1) {
        anim.t = 0; anim.i++;
        const cap = anim.m.caps[anim.i - 1];
        if (cap) {
          PP.burst(geo.x + (cap[1] + 0.5) * geo.cell, geo.y + (cap[0] + 0.5) * geo.cell, ['#fff', '#888', '#e8553e'], 16, 180, 3, 0.6, 300);
          sfx.noise(0.12, 0.2, 2000); PP.shake = 4;
          board[cap[0]][cap[1]] = 0;
        }
        if (anim.i >= anim.m.path.length - 1) finishMove();
      }
    } else if (!winner && mode === 0 && turn === 2) {
      aiTimer -= dt;
      if (aiTimer <= 0) doMove(aiMove());
    }
  }

  // ── DISEGNO ─────────────────────────────────────
  function piece(ctx, x, y, r, v, lift = 0) {
    const red = own(v, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.22 + lift, r, r * 0.95, 0, 0, 7); ctx.fill();
    y -= lift;
    ctx.fillStyle = red ? '#9e2416' : '#141414';
    ctx.beginPath(); ctx.arc(x, y + r * 0.12, r, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, red ? '#ff7a5c' : '#5a5a5a'); g.addColorStop(1, red ? '#d1361f' : '#222');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = red ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, 7); ctx.stroke();
    if (isKing(v)) {
      ctx.fillStyle = '#ffd54a';
      const w = r * 0.9, h = r * 0.5, by = y + h * 0.4;
      ctx.beginPath(); ctx.moveTo(x - w / 2, by); ctx.lineTo(x - w / 2, by - h); ctx.lineTo(x - w / 4, by - h * 0.45); ctx.lineTo(x, by - h * 1.1); ctx.lineTo(x + w / 4, by - h * 0.45); ctx.lineTo(x + w / 2, by - h); ctx.lineTo(x + w / 2, by); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function draw(ctx, W, H) {
    layout();
    const bg = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#4a2e1c'); bg.addColorStop(1, '#1e120a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const { x, y, cell } = geo;
    // cornice
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    PP.rr(x - cell * 0.25, y - cell * 0.25, cell * 8.5, cell * 8.5, cell * 0.2); ctx.fillStyle = '#5b3820'; ctx.fill(); ctx.restore();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#7a4a2a' : '#e9cfa3';
      ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
    if (!board) return;
    if (lastMove && PP.state !== 'menu') for (const [r, c] of [lastMove.path[0], lastMove.path[lastMove.path.length - 1]]) { ctx.fillStyle = 'rgba(255,213,74,.22)'; ctx.fillRect(x + c * cell, y + r * cell, cell, cell); }

    const humanTurn = PP.state === 'playing' && !anim && !winner && (mode === 1 || turn === 1);
    // pezzi che possono muovere
    const movable = new Set(humanTurn ? legal.map(m => m.path[0].join()) : []);
    if (humanTurn && legal[0] && legal[0].caps.length) for (const k of movable) { const [r, c] = k.split(',').map(Number); ctx.strokeStyle = 'rgba(255,213,74,.9)'; ctx.lineWidth = 3; ctx.strokeRect(x + c * cell + 2, y + r * cell + 2, cell - 4, cell - 4); }
    if (selected) {
      ctx.fillStyle = 'rgba(80,200,255,.28)'; ctx.fillRect(x + selected[1] * cell, y + selected[0] * cell, cell, cell);
      for (const m of legal) if (m.path[0][0] === selected[0] && m.path[0][1] === selected[1]) {
        const [tr, tc] = m.path[m.path.length - 1];
        PP.circle(x + (tc + 0.5) * cell, y + (tr + 0.5) * cell, cell * 0.16, 'rgba(80,200,255,.85)');
      }
    }
    const rad = cell * 0.38;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = board[r][c];
      if (!v) continue;
      if (anim && anim.m.path[0][0] === r && anim.m.path[0][1] === c) continue;
      const sel = selected && selected[0] === r && selected[1] === c;
      piece(ctx, x + (c + 0.5) * cell, y + (r + 0.5) * cell, rad, v, sel ? cell * 0.08 : 0);
    }
    if (anim) {
      const a = anim.m.path[anim.i], b = anim.m.path[Math.min(anim.i + 1, anim.m.path.length - 1)];
      const t = PP.easeInOut(Math.min(1, anim.t));
      const px = x + (PP.lerp(a[1], b[1], t) + 0.5) * cell, py = y + (PP.lerp(a[0], b[0], t) + 0.5) * cell;
      piece(ctx, px, py, rad, anim.v, Math.sin(t * Math.PI) * cell * (anim.m.caps.length ? 0.35 : 0.12));
    }
    PP.drawFx();

    if (PP.state !== 'menu') {
      const cnt = p => board.flat().filter(v => own(v, p)).length;
      const name = p => (mode === 1 ? (p === 1 ? 'Red' : 'Dark') : p === 1 ? 'You' : 'Computer');
      PP.circle(22, 32, 9, turn === 1 ? '#e8553e' : '#333');
      const status = winner ? 'Game over' : mode === 0 ? (turn === 1 ? 'Your turn' : 'Computer is thinking…') : `${name(turn)}'s turn`;
      PP.text(status, 38, 33, 17, '#fff', 'left', 800);
      PP.text(`${name(1)} ${cnt(1)} · ${name(2)} ${cnt(2)}${legal && legal[0] && legal[0].caps.length && !winner ? ' · capture!' : ''}`, 16, 56, 12, 'rgba(255,255,255,.65)', 'left', 600);
    }
  }

  // ── INPUT ───────────────────────────────────────
  function cellAt(p) {
    const c = Math.floor((p.x - geo.x) / geo.cell), r = Math.floor((p.y - geo.y) / geo.cell);
    return r >= 0 && r < 8 && c >= 0 && c < 8 ? [r, c] : null;
  }
  function pointerDown(p) {
    if (anim || winner || (mode === 0 && turn === 2)) return;
    const rc = cellAt(p);
    if (!rc) { selected = null; return; }
    const [r, c] = rc;
    if (selected) {
      const m = legal.find(m => m.path[0][0] === selected[0] && m.path[0][1] === selected[1] && m.path[m.path.length - 1][0] === r && m.path[m.path.length - 1][1] === c);
      if (m) { doMove(m); return; }
    }
    if (legal.some(m => m.path[0][0] === r && m.path[0][1] === c)) { selected = [r, c]; sfx.click(); }
    else if (own(board[r][c], turn)) { selected = null; sfx.tone(180, 0.08, 'square', 0.06); PP.floatText(legal[0] && legal[0].caps.length ? 'You must capture!' : 'No moves', p.x, p.y - 20, '#ffd54a', 15); }
    else selected = null;
  }
  function keyDown(code) {
    if ((code === 'KeyZ' || code === 'Backspace') && history.length && !anim && !winner) {
      // annulla: in modalità computer torna indietro di due mezze mosse
      const steps = mode === 0 ? 2 : 1;
      for (let i = 0; i < steps && history.length; i++) board = history.pop();
      turn = mode === 0 ? 1 : 3 - turn; legal = allMoves(board, turn); selected = null; lastMove = null; aiTimer = 0;
      sfx.tone(420, 0.08, 'sine', 0.1, 300);
    }
  }

  function demo(n) {
    const boards = {
      1: ['.2.2.2.2', '2.2.2.2.', '.2...2.2', '..2.....', '.1.1....', '1...1.1.', '.1.1.1.1', '1.1.1.1.'],
      2: ['.......2', '..2.....', '...2.4..', '........', '.1...1..', '..3.....', '.1......', '........'],
      3: ['.2.2...2', '2.2.....', '...2.2..', '..1.....', '...1.1..', '1.....1.', '.1.1.1.1', '1.1.1...'],
    }[n];
    board = boards.map(row => [...row].map(ch => ch === '.' ? 0 : +ch));
    turn = 1; legal = allMoves(board, 1); anim = null; winner = 0; lastMove = null;
    if (n === 1) selected = [4, 3];
    if (n === 3) { const m = legal.find(m => m.caps.length) || legal[0]; selected = m.path[0]; }
    if (n === 2) { selected = [5, 2]; lastMove = { path: [[6, 1], [5, 2]], caps: [] }; PP.burst(geo.x + 2.5 * geo.cell, geo.y + 5.5 * geo.cell, ['#ffd54a', '#fff'], 22, 140, 4, 2, 0); }
  }

  function icon(c, S) {
    c.fillStyle = '#3a2414'; c.fillRect(0, 0, S, S);
    const cell = S * 0.15, x0 = S / 2 - cell * 2, y0 = S / 2 - cell * 2;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { c.fillStyle = (r + k) % 2 ? '#7a4a2a' : '#e9cfa3'; c.fillRect(x0 + k * cell, y0 + r * cell, cell, cell); }
    const draw1 = (cx, cy, v) => piece(c, cx, cy, cell * 0.4, v, 0);
    draw1(x0 + 1.5 * cell, y0 + 0.5 * cell, 2);
    draw1(x0 + 0.5 * cell, y0 + 3.5 * cell, 1);
    draw1(x0 + 2.5 * cell, y0 + 1.5 * cell, 3);
    draw1(x0 + 3.5 * cell, y0 + 2.5 * cell, 2);
  }

  PP.run({
    id: GAME_ID,
    title: 'Checkers',
    intro: 'Jump over your opponent\'s pieces and capture them all.\nCaptures are mandatory. Reach the far side to crown a king.',
    bestText: () => (mode === 0 ? `${LEVELS[level]}: ${stats.w} wins · ${stats.l} losses` : ''),
    choices: () => [
      { label: 'Opponent', options: MODES, value: mode, onChange: i => { mode = i; store.set('mode', i); PP.showMain(); } },
      ...(mode === 0 ? [{ label: 'Difficulty', options: LEVELS, value: level, onChange: i => { level = i; store.set('level', i); stats = store.get(`stats-${level}`, { w: 0, l: 0 }); PP.showMain(); } }] : []),
    ],
    pauseText: () => (mode === 0 ? `${LEVELS[level]} difficulty` : 'Two players'),
    init() { mode = store.get('mode', 0); level = store.get('level', 1); stats = store.get(`stats-${level}`, { w: 0, l: 0 }); board = newBoard(); },
    start, update, draw, pointerDown, keyDown, demo, icon,
    resize: layout,
  });
})();
