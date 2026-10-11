import { Renderer } from './render/renderer';
import { buildSprites } from './render/sprites';
import { SPECIES_COLORS, hueColor } from './render/palette';
import { generateTerrain, PRESETS, Preset } from './sim/terrain';
import { ACTION_NAMES, N_ACTIONS, SPECIES } from './sim/species';
import { CAUSE_NAMES, N_CAUSES, SEASON_NAMES, DAYS_PER_SEASON, DAYS_PER_YEAR, TICKS_PER_DAY, TRAIT_NAMES, TRAIT_RANGES } from './sim/constants';
import { LOG_NAMES } from './sim/world';
import type { Instinct } from './sim/brain';
import type { Frame, FromWorker, InspectInfo, StatsRow, ToWorker } from './sim/protocol';
import { ICONS } from './ui/icons';
import { PopulationChart } from './ui/chart';
import { Timeline } from './ui/timeline';
import { Narrator } from './ui/narrator';
import { decodeShare, encodeShare } from './ui/share';
import { daylight } from './render/renderer';
import { ClipRecorder } from './ui/clip';
import { CHALLENGES, Challenge } from './ui/challenges';
import { renderDetail } from './ui/detail';

const ACTION_COLORS = ['#7fb069', '#4f9fd0', '#8d6e4c', '#e0584a', '#a9c4d6', '#b22f2f', '#7d4fa0', '#4a4440', '#e48fb1', '#bdb8ab', '#e8c547', '#b08436', '#c47a3a', '#6b8e23', '#f29e4c'];
const CAUSE_COLORS = ['#c9a227', '#4f9fd0', '#b22f2f', '#9a9c94', '#7cb342', '#e8642c', '#5d4037', '#8e24aa'];

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const app = document.getElementById('app')!;
app.innerHTML = `
<header class="top">
  <div class="brand">${ICONS.logo}<span>Thicket</span></div>
  <div class="calendar"><span class="sky"></span><span class="when">—</span><span class="clock"></span></div>
  <div class="spacer"></div>
  <div class="controls" id="controls">
    <button data-speed="0" title="Pause (Space)">${ICONS.pause}</button>
    <button data-speed="24" title="1 day per second (1)">1×</button>
    <button data-speed="96" title="4 days per second (2)">4×</button>
    <button data-speed="384" title="16 days per second (3)">16×</button>
    <button data-speed="-1" title="As fast as possible (4)">Max</button>
    <button data-step title="Step one hour (→)">${ICONS.step}</button>
  </div>
  <div class="spacer"></div>
  <span class="perf" id="perf"></span>
  <button class="btn" id="btn-help" title="How it works (?)" aria-label="How it works (?)">?</button>
  <button class="btn" id="btn-theme" title="Theme: auto" aria-label="Theme: auto">${ICONS.theme}</button>
  <button class="btn" id="btn-clip" title="Record a clip" aria-label="Record a clip">${ICONS.clip}<span class="lbl">Clip</span></button>
  <button class="btn" id="btn-callit" title="Predict the first extinction" aria-label="Predict the first extinction">${ICONS.target}<span class="lbl">Call it</span></button>
  <button class="btn" id="btn-daily" title="Today's shared world" aria-label="Today's shared world">${ICONS.sun}<span class="lbl">Daily</span></button>
  <button class="btn" id="btn-modes" title="Challenges and twin worlds" aria-label="Challenges and twin worlds">${ICONS.flag}<span class="lbl">Play</span></button>
  <button class="btn" id="btn-new">${ICONS.globe}<span class="lbl">New world</span></button>
  <button class="btn primary" id="btn-share">${ICONS.share}<span class="lbl">Share</span></button>
</header>
<nav class="tools" id="tools">
  <button class="tool on" data-tool="inspect" aria-label="Inspect (I)">${ICONS.inspect}<span class="tip">Inspect (I)</span></button>
  <button class="tool" data-tool="release" aria-label="Release animals (R)">${ICONS.release}<span class="tip">Release animals (R)</span></button>
  <button class="tool" data-tool="cull" aria-label="Cull (C)">${ICONS.cull}<span class="tip">Cull (C)</span></button>
  <div class="sep"></div>
  <button class="tool" data-tool="ignite" aria-label="Ignite a fire">${ICONS.fire}<span class="tip">Ignite a fire</span></button>
  <button class="tool" data-tool="rain" aria-label="Rain">${ICONS.rain}<span class="tip">Rain</span></button>
  <button class="tool" data-tool="drought" aria-label="Drought (one season)">${ICONS.drought}<span class="tip">Drought (one season)</span></button>
  <button class="tool" data-tool="poison" aria-label="Poison water">${ICONS.poison}<span class="tip">Poison water</span></button>
  <button class="tool" data-tool="pesticide" aria-label="Pesticide">${ICONS.bug}<span class="tip">Pesticide</span></button>
  <button class="tool" data-tool="plant" aria-label="Plant trees">${ICONS.plant}<span class="tip">Plant trees</span></button>
  <button class="tool" data-tool="wall" aria-label="Wall (drag)">${ICONS.wall}<span class="tip">Wall (drag)</span></button>
  <button class="tool" data-tool="outbreak" aria-label="Start an outbreak">${ICONS.virus}<span class="tip">Start an outbreak</span></button>
  <button class="tool" data-tool="food" aria-label="Food drop">${ICONS.berry}<span class="tip">Food drop</span></button>
  <button class="tool" data-tool="dam" aria-label="Dam or breach a stream">${ICONS.dam}<span class="tip">Dam or breach a stream</span></button>
  <div class="sep"></div>
  <button class="tool" data-layer="fear" aria-label="Landscape of fear">${ICONS.fear}<span class="tip">Landscape of fear</span></button>
  <button class="tool" data-layer="lineage" aria-label="Bloodlines">${ICONS.dna}<span class="tip">Bloodlines</span></button>
</nav>
<main class="stage" id="stage">
  <canvas id="map"></canvas>
  <canvas id="map2" hidden></canvas>
  <div class="twin-label" id="lbl-a" hidden>Your world</div>
  <div class="twin-label" id="lbl-b" hidden>Untouched twin <button id="twin-close" title="Close the twin">×</button></div>
  <div class="toolbar" id="toolbar" hidden></div>
  <div class="narrator" id="narrator"></div>
  <div class="seeking" id="seeking" hidden>Rewinding…</div>
  <div class="banner" id="banner" hidden></div>
  <div class="banner" id="rec" hidden style="top:12px;bottom:auto;right:12px;left:auto;transform:none;background:#c62828">● REC</div>
  <div class="legend" id="legend" hidden></div>
  <div class="zoom"><button data-z="director" title="Director: the camera finds the drama (D)" id="btn-director">🎬</button><button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Fit map">⤢</button></div>
</main>
<footer class="timeline">
  <div class="row"><span id="tl-left">Day 0</span><span id="tl-hover"></span><span id="tl-right"></span></div>
  <canvas id="tl"></canvas>
</footer>
<aside class="panel" id="panel">
  <section class="section" id="challenge" hidden></section>
  <section class="section inspect" id="inspect" hidden></section>
  <section class="section">
    <h3>Species <span class="aside" id="sp-total"></span></h3>
    <div id="species"></div>
    <div class="act-legend" id="act-legend"></div>
  </section>
  <section class="section">
    <h3>Population <span class="seg" id="scale"><button data-scale="log" class="on">Log</button><button data-scale="lin">Linear</button></span></h3>
    <canvas class="chart" id="chart"></canvas>
  </section>
  <section class="section" id="detail" hidden></section>
  <section class="section">
    <h3>Deaths, last 7 days <span class="aside" id="death-total"></span></h3>
    <div id="deaths"></div>
  </section>
  <section class="section">
    <h3>Story so far</h3>
    <div id="history" class="hint">Nothing yet.</div>
  </section>
</aside>
<dialog id="dlg-new">
  <h2>New world</h2>
  <p class="lead">Every world comes from a seed. The same seed and the same actions always give the same story.</p>
  <div class="field"><label for="nw-preset">Landscape</label><select id="nw-preset">${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
  <div class="field"><label for="nw-seed">Seed</label><div class="row"><input id="nw-seed" type="number" min="0" max="4294967295" /><button class="btn" id="nw-dice" type="button">Random</button></div></div>
  <div class="field"><label for="nw-instinct">Instinct</label><select id="nw-instinct">
    <option value="newborn">Newborn: blank brains, watch them learn</option>
    <option value="wild" selected>Wild: half-trained (default)</option>
    <option value="expert">Expert: fully trained</option>
  </select></div>
  <div class="dialog-actions"><button class="btn" id="nw-cancel">Cancel</button><button class="btn primary" id="nw-go">Create world</button></div>
</dialog>
<dialog id="dlg-help" style="width:min(620px,94vw)">
  <h2>Welcome to Thicket</h2>
  <p class="lead">A living valley of sixteen species. Every animal decides for itself each hour, learns from what happens, and passes its traits to its young. Nothing is scripted.</p>
  <div class="help-grid">
    <div><b>Watch</b><p>Click any animal to see what it senses, what each action is worth to it, and why it chose what it did. The camera follows it.</p></div>
    <div><b>Meddle</b><p>Use the tools on the left: release or cull animals, light fires, bring rain or drought, poison a lake, plant trees, build walls and dams, start an outbreak.</p></div>
    <div><b>Rewind</b><p>Drag the timeline back to any moment. Act there and the world branches; the old future is gone unless you twin it first.</p></div>
    <div><b>Share</b><p>A share link holds the seed and every action, so whoever opens it gets exactly your world. Clips record the map with narration.</p></div>
  </div>
  <div class="subhead">Keys</div>
  <div class="keys"><span><kbd>Space</kbd> pause</span><span><kbd>1</kbd>–<kbd>4</kbd> speed</span><span><kbd>→</kbd> one hour (<kbd>Shift</kbd> a day)</span><span><kbd>I</kbd> inspect</span><span><kbd>R</kbd> release</span><span><kbd>C</kbd> cull</span><span><kbd>F</kbd> follow</span><span><kbd>D</kbd> director camera</span><span><kbd>Esc</kbd> deselect</span><span><kbd>?</kbd> this help</span></div>
  <div class="dialog-actions"><button class="btn primary" id="help-close">Start watching</button></div>
</dialog>
<dialog id="dlg-play" style="width:min(560px,94vw)">
  <h2>Play</h2>
  <p class="lead">Take on a challenge, or split this world in two and see what your meddling changed.</p>
  <div id="play-list"></div>
  <div class="subhead" style="margin-top:14px">Twin worlds</div>
  <p class="hint" style="margin:0 0 8px">Copies this world at this moment. From then on, your actions change only the left world; the right one carries on untouched.</p>
  <div class="dialog-actions" style="justify-content:space-between"><button class="btn" id="play-twin">Twin this world</button><button class="btn" id="play-close">Close</button></div>
</dialog>
<dialog id="dlg-clip">
  <h2>Record a clip</h2>
  <p class="lead">Records the map as it plays, with the date, narration and a population strip, then a closing card with the seed.</p>
  <div class="field"><label for="clip-fmt">Format</label><select id="clip-fmt"><option value="p">Portrait 1080×1920 (Reels, TikTok, Shorts)</option><option value="l">Landscape 1920×1080</option></select></div>
  <div class="field"><label for="clip-len">Length</label><select id="clip-len"><option value="10">10 seconds</option><option value="20" selected>20 seconds</option><option value="30">30 seconds</option></select></div>
  <p class="hint">Tip: turn on the Director (🎬, or press D) and the camera will find the chases, fires and last survivors for you.</p>
  <div class="dialog-actions"><button class="btn" id="clip-cancel">Cancel</button><button class="btn primary" id="clip-go">Record</button></div>
</dialog>
<dialog id="dlg-callit">
  <h2>Call it</h2>
  <p class="lead">Which species will be lost first, and by which day? Lock in your call, then watch.</p>
  <div class="field"><label for="ci-sp">First to go</label><select id="ci-sp"></select></div>
  <div class="field"><label for="ci-day">By day</label><input id="ci-day" type="number" min="1" max="2000" value="120" /></div>
  <div class="dialog-actions"><button class="btn" id="ci-cancel">Cancel</button><button class="btn primary" id="ci-go">Lock it in</button></div>
</dialog>
<dialog id="dlg-result">
  <h2 id="res-title">Result</h2>
  <p class="lead" id="res-body"></p>
  <div class="dialog-actions"><button class="btn" id="res-close">Keep watching</button><button class="btn primary" id="res-share">Share this ending</button></div>
</dialog>
<dialog id="dlg-share">
  <h2>Share this world</h2>
  <p class="lead">This link holds the seed and everything you did. Anyone who opens it replays this exact world to this moment.</p>
  <textarea class="share-url" id="share-url" readonly></textarea>
  <p class="hint" id="share-meta"></p>
  <div class="dialog-actions"><button class="btn" id="share-close">Close</button><button class="btn primary" id="share-copy">Copy link</button></div>
</dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);

const renderer = new Renderer($<HTMLCanvasElement>('#map'), SPECIES.map((s) => s.color));
const chart = new PopulationChart($<HTMLCanvasElement>('#chart'));
const timeline = new Timeline($<HTMLCanvasElement>('#tl'));
const narrator = new Narrator($('#narrator'));
const icons = buildSprites(SPECIES.map((s) => s.color));

let rows: StatsRow[] = [];
let speed = 24;
let lastSpeed = 24;
type Tool = 'inspect' | 'release' | 'cull' | 'ignite' | 'rain' | 'drought' | 'poison' | 'pesticide' | 'plant' | 'wall' | 'outbreak' | 'food' | 'dam';
let tool: Tool = 'inspect';
let toolOpt = { rainR: 20, pestR: 12, plantKind: 0, pathogen: 1, foodKind: 0, damMode: 0 };
let toolSpecies = 7;
let toolCount = 6;
let cullRadius = 10;
let lastFrame: Frame | null = null;
let present = new Set<number>();
let focus = -1;
let seeking = false;
let weatherNow = 0;
const WEATHER = ['Clear', 'Rain', 'Storm', 'Heatwave', 'Cold snap'];
let world = { seed: 0, preset: 'valley' as Preset, instinct: 'wild' as Instinct };

// ---------------------------------------------------------------------------
// worker messages
// ---------------------------------------------------------------------------

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'ready': {
      world = { seed: m.seed, preset: m.preset, instinct: m.instinct };
      renderer.setTerrain(generateTerrain(m.preset, m.seed, m.w, m.h));
      renderer.selectedId = 0;
      narrator.reset();
      present = new Set();
      call = null;
      firstLoss = null;
      $('#btn-callit').innerHTML = `${ICONS.target}<span class="lbl">Call it</span>`;
      buildSpeciesRows();
      renderInspect(null);
      $('#tl-right').textContent = `${PRESETS.find((p) => p.id === m.preset)?.name} · seed ${m.seed} · ${m.instinct}`;
      break;
    }
    case 'frame':
      onFrame(m);
      break;
    case 'terrain':
      renderer.updateTerrain(m.ttype, m.depth);
      break;
    case 'grass':
      renderer.setGrass(m.data, m.fear, m.scar, m.wall, m.toxin);
      break;
    case 'stats': {
      if (m.reset) rows = [];
      for (const r of m.rows) {
        rows[r.day] = r;
        if (!m.reset) narrator.onRow(r, rows);
      }
      chart.rows = rows;
      timeline.rows = rows;
      chartDirty = true;
      if (focus >= 0) renderDetail($('#detail'), rows, focus);
      renderDeaths();
      renderHistory();
      break;
    }
    case 'events':
      for (const e of m.events) if (e.kind === 'extinct') judgeCall(e.sp, Math.floor(e.tick / TICKS_PER_DAY));
      narrator.onEvents(m.events);
      renderHistory();
      break;
    case 'inspect':
      renderInspect(m.info);
      break;
    case 'preview':
      renderer.showStill(m.n, m.f, m.u, m.day * TICKS_PER_DAY);
      setCalendar(m.day * TICKS_PER_DAY);
      break;
    case 'seeking':
      seeking = m.busy;
      $('#seeking').hidden = !m.busy;
      break;
    case 'marks':
      timeline.marks = m.marks;
      break;
    case 'share':
      if (m.purpose === 'twin') {
        twinStart(m.payload);
        break;
      }
      void encodeShare(m.payload).then((frag) => {
        const url = `${location.origin}${location.pathname}${frag}`;
        $<HTMLTextAreaElement>('#share-url').value = url;
        $('#share-meta').textContent = `Day ${Math.floor(m.payload.tick / TICKS_PER_DAY)}, ${m.payload.log.length} action${m.payload.log.length === 1 ? '' : 's'}, state ${m.payload.hash}. Link length ${url.length} characters.`;
        history.replaceState(null, '', frag);
        $<HTMLDialogElement>('#dlg-share').showModal();
      });
      break;
    case 'verify':
      $('#tl-hover').textContent = m.ok ? `✓ replay verified at day ${Math.floor(m.tick / TICKS_PER_DAY)}` : '⚠ replay differs from the shared world';
      toast(m.ok ? `Replay verified: day ${Math.floor(m.tick / TICKS_PER_DAY)} matches the shared world exactly.` : `Warning: this replay differs from the shared world (expected ${m.expected}, got ${m.got}).`);
      break;
  }
};

let lastPanel = 0;
function onFrame(f: Frame): void {
  lastFrame = f;
  checkChallenge(f);
  if (timeline.dragTick < 0) renderer.pushFrame(f.n, f.f, f.u, f.tick);
  renderer.carcasses = f.carcasses;
  renderer.warrens = f.warrens;
  if (f.trees) renderer.trees = f.trees;
  renderer.fire = f.fire;
  renderer.dams = f.dams;
  renderer.weather = f.weather;
  renderer.wind = f.wind;
  if (f.weather !== weatherNow && (f.weather === 2 || f.weather === 3 || f.weather === 4)) {
    const day = Math.floor(f.tick / TICKS_PER_DAY);
    narrator.note(day, ['', '', 'A <b>storm</b> rolls in. Fires spread with the wind.', 'A <b>heatwave</b>. Water matters now.', 'A <b>cold snap</b>. Everyone burns more to stay warm.'][f.weather], `wx${f.weather}`, 6);
  }
  weatherNow = f.weather;
  for (const l of f.lineages) renderer.lineageHue.set(l.sp * 8 + l.slot, l.hue);
  timeline.tick = f.tick;
  timeline.head = f.head;
  chart.cursorDay = f.tick < f.head ? Math.floor(f.tick / TICKS_PER_DAY) : -1;
  if (timeline.dragTick < 0) setCalendar(f.tick);
  $('#banner').hidden = !f.ceiling;
  $('#banner').textContent = 'The world is at its 12,000-animal ceiling: births are paused for the most numerous species.';
  const now = performance.now();
  if (now - lastPanel > 200) {
    lastPanel = now;
    updateSpecies(f);
    const total = f.counts.reduce((a, b) => a + b, 0);
    const slowed = speed > 0 && f.tps > 0 && f.tps < speed * 0.8;
    $('#perf').textContent = `${total.toLocaleString()} animals · ${f.msPerTick.toFixed(1)} ms/tick${speed < 0 || slowed ? ` · ${(f.tps / 24).toFixed(1)} days/s${slowed ? ' (busy world: running slower than chosen)' : ''}` : ''}`;
    $('#tl-left').textContent = f.tick < f.head ? `Day ${Math.floor(f.tick / TICKS_PER_DAY)} of ${Math.floor(f.head / TICKS_PER_DAY)} (rewound)` : `Day ${Math.floor(f.tick / TICKS_PER_DAY)}`;
  }
}

function setCalendar(tick: number): void {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const year = Math.floor(day / DAYS_PER_YEAR) + 1;
  const season = SEASON_NAMES[Math.floor((day % DAYS_PER_YEAR) / DAYS_PER_SEASON)];
  const dayOfSeason = (day % DAYS_PER_SEASON) + 1;
  $('.calendar .when').textContent = `Year ${year} · ${season} · Day ${dayOfSeason}`;
  $('.calendar .clock').textContent = `${String(tick % TICKS_PER_DAY).padStart(2, '0')}:00 · ${WEATHER[weatherNow]}`;
  $('.calendar .sky').innerHTML = daylight(tick) > 0.5 ? ICONS.sun : ICONS.moon;
}

// ---------------------------------------------------------------------------
// species panel
// ---------------------------------------------------------------------------

function buildSpeciesRows(): void {
  const host = $('#species');
  host.innerHTML = '';
  for (const sp of SPECIES) {
    if (!sp.enabled && sp.id !== 8) continue;
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.dataset.sp = String(sp.id);
    row.innerHTML = `<span class="dot" style="background:${SPECIES_COLORS[sp.id]}"></span><span class="name">${sp.plural}</span><span class="count">0</span>
      <div class="bars"><div class="bar act"></div><div class="bar thin lin" title="Bloodlines"></div></div>`;
    row.addEventListener('click', () => {
      focus = focus === sp.id ? -1 : sp.id;
      chart.focus = focus;
      chartDirty = true;
      renderDetail($('#detail'), rows, focus);
      host.querySelectorAll('.sp-row').forEach((r) => r.classList.toggle('focus', Number((r as HTMLElement).dataset.sp) === focus));
    });
    host.appendChild(row);
  }
  const used = new Set<number>();
  for (const sp of SPECIES) if (sp.enabled) for (const a of sp.actions) used.add(a);
  $('#act-legend').innerHTML = [...used].sort((a, b) => a - b).map((a) => `<span><i style="background:${ACTION_COLORS[a]}"></i>${ACTION_NAMES[a]}</span>`).join('');
}

function updateSpecies(f: Frame): void {
  const host = $('#species');
  let total = 0;
  for (const row of host.querySelectorAll<HTMLElement>('.sp-row')) {
    const s = Number(row.dataset.sp);
    const n = f.counts[s];
    total += n;
    if (n > 0) present.add(s);
    const week = rows[Math.max(0, Math.floor(f.tick / TICKS_PER_DAY) - 7)];
    const then = week ? week.counts[s] : n;
    const d = n - then;
    const pct = then > 0 ? Math.round((d / then) * 100) : 0;
    const tw = twin?.frame ? `<span class="delta" style="color:var(--muted)" title="Untouched twin">twin ${twin.frame.counts[s].toLocaleString()}</span>` : '';
    row.querySelector('.count')!.innerHTML = `${n.toLocaleString()}${tw || (then > 0 && Math.abs(pct) >= 5 ? `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${pct}%</span>` : '')}`;
    row.classList.toggle('gone', n === 0 && present.has(s));
    row.style.display = n === 0 && !present.has(s) ? 'none' : '';
    let sum = 0;
    for (let a = 0; a < N_ACTIONS; a++) sum += f.actions[s * N_ACTIONS + a];
    const act = row.querySelector('.act')!;
    act.innerHTML = sum
      ? SPECIES[s].actions.map((a) => {
          const v = f.actions[s * N_ACTIONS + a];
          return v ? `<span style="width:${(100 * v) / sum}%;background:${ACTION_COLORS[a]}" title="${ACTION_NAMES[a]} ${Math.round((100 * v) / sum)}%"></span>` : '';
        }).join('')
      : '';
    const lins = f.lineages.filter((l) => l.sp === s && l.members > 0);
    const lsum = lins.reduce((a, l) => a + l.members, 0);
    row.querySelector('.lin')!.innerHTML = lins.map((l) => `<span style="width:${(100 * l.members) / lsum}%;background:${hueColor(l.hue, 60, 55)}" title="Bloodline ${l.slot + 1}: ${l.members} animals, avg reward ${l.reward.toFixed(3)}/h"></span>`).join('');
  }
  $('#sp-total').textContent = `${total.toLocaleString()} animals`;
}

function renderDeaths(): void {
  const recent = rows.filter(Boolean).slice(-7);
  const host = $('#deaths');
  const per: { s: number; c: number[]; t: number }[] = [];
  let all = 0;
  for (const sp of SPECIES) {
    if (!sp.enabled) continue;
    const c = new Array(N_CAUSES).fill(0);
    for (const r of recent) for (let k = 0; k < N_CAUSES; k++) c[k] += r.deaths[sp.id * N_CAUSES + k];
    const t = c.reduce((a, b) => a + b, 0);
    all += t;
    if (t > 0) per.push({ s: sp.id, c, t });
  }
  per.sort((a, b) => b.t - a.t);
  $('#death-total').textContent = all ? `${all.toLocaleString()} deaths` : '';
  if (!per.length) {
    host.innerHTML = '<div class="hint">No deaths yet.</div>';
    return;
  }
  const max = per[0].t;
  host.innerHTML =
    per.map((p) => `<div style="display:grid;grid-template-columns:70px 1fr 40px;gap:8px;align-items:center;margin:3px 0;font-size:12px">
      <span>${SPECIES[p.s].plural}</span>
      <div class="bar" style="height:7px;width:${Math.max(4, (100 * p.t) / max)}%">${p.c.map((v, k) => (v ? `<span style="width:${(100 * v) / p.t}%;background:${CAUSE_COLORS[k]}" title="${CAUSE_NAMES[k]} ${v}"></span>` : '')).join('')}</div>
      <span style="text-align:right;color:var(--muted);font-variant-numeric:tabular-nums">${p.t}</span></div>`).join('') +
    `<div class="act-legend">${CAUSE_NAMES.map((n, k) => (per.some((p) => p.c[k]) ? `<span><i style="background:${CAUSE_COLORS[k]}"></i>${n}</span>` : '')).join('')}</div>`;
}

function renderHistory(): void {
  const h = narrator.history.slice(-10).reverse();
  $('#history').innerHTML = h.length ? h.map((c) => `<div style="margin:3px 0"><span style="color:var(--faint);font-variant-numeric:tabular-nums">Day ${c.day}</span> · ${c.html}</div>`).join('') : 'Nothing yet.';
}

// ---------------------------------------------------------------------------
// inspect panel
// ---------------------------------------------------------------------------

let inspectShown = 0;
function renderInspect(info: InspectInfo | null): void {
  const host = $('#inspect');
  if (!info) {
    host.hidden = true;
    renderer.selectedId = 0;
    renderer.follow = false;
    return;
  }
  const now = performance.now();
  if (now - inspectShown < 180 && info.alive) return;
  inspectShown = now;
  host.hidden = false;
  const sp = SPECIES[info.sp];
  const qmax = Math.max(...info.q.map(Math.abs), 0.01);
  const qmin = Math.min(0, ...info.q);
  const chosen = info.actions.indexOf(info.action);
  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  const hot = new Set(['starving', 'hungry', 'parched', 'thirsty', 'ground threat close', 'air threat close', 'ground threat near', 'air threat near', 'danger close', 'danger near', 'crowded']);
  const ageTxt = info.age < 2 ? `${Math.round(info.age * 24)} hours` : `${Math.round(info.age)} days`;
  host.innerHTML = `
    <div class="insp-head">
      <canvas width="88" height="88" id="insp-icon"></canvas>
      <div class="who"><div class="nm">${info.name}</div>
        <div class="sub">${info.sex ? 'Female' : 'Male'} ${sp.name.toLowerCase()} · ${ageTxt} old · <span style="color:${hueColor(info.hue, 60, 45)}">bloodline ${info.lineage + 1}</span>${info.kills ? ` · ${info.kills} kill${info.kills > 1 ? 's' : ''}` : ''}</div></div>
      <button class="x" id="insp-close" title="Close (Esc)">×</button>
    </div>
    ${info.alive ? '' : `<div class="dead-note">Died on day ${Math.floor((info.diedTick ?? 0) / TICKS_PER_DAY)}.</div>`}
    ${info.sickWith ? `<div class="dead-note" style="color:#6a9a1f">Sick with ${info.sickWith}.</div>` : ''}
    ${info.dormant === 1 ? '<div class="hint" style="margin-bottom:8px">Hibernating until the warmth returns.</div>' : info.dormant === 2 ? '<div class="hint" style="margin-bottom:8px">Away on migration; due back in spring.</div>' : ''}
    <div class="why">${info.why.replace(/^([A-Z][a-z]+)/, '<b>$1</b>')}</div>
    <div class="needs">
      <span>Energy</span><div class="bar"><span style="width:${pct(info.energy)};background:#7fb069"></span></div><span class="v">${pct(info.energy)}</span>
      <span>Water</span><div class="bar"><span style="width:${pct(info.hydration)};background:#4f9fd0"></span></div><span class="v">${pct(info.hydration)}</span>
      <span>Health</span><div class="bar"><span style="width:${pct(info.health)};background:#e48fb1"></span></div><span class="v">${pct(info.health)}</span>
      <span>Stamina</span><div class="bar"><span style="width:${pct(info.stamina)};background:#e8c547"></span></div><span class="v">${pct(info.stamina)}</span>
    </div>
    <div class="subhead">What it senses</div>
    <div class="chips">${info.state.map((s) => `<span class="chip ${hot.has(s) ? 'hot' : ''}">${s}</span>`).join('')}</div>
    <div class="subhead">What each action is worth here</div>
    <div class="qlist">${info.actions.map((a, k) => `<span class="lbl ${k === chosen ? 'on' : ''}">${ACTION_NAMES[a]}</span><div class="qbar ${k === chosen ? 'on' : ''}"><span style="width:${(100 * (info.q[k] - qmin)) / (qmax - qmin || 1)}%"></span></div><span class="v">${info.q[k].toFixed(2)}</span>`).join('')}</div>
    <div class="subhead">Inherited traits <span style="text-transform:none;letter-spacing:0;font-weight:400">(line = species average)</span></div>
    <div class="traits">${info.traits.map((v, k) => {
      const [lo, hi] = TRAIT_RANGES[k];
      const p = (x: number) => `${(100 * (x - lo)) / (hi - lo)}%`;
      return `<span>${TRAIT_NAMES[k]}</span><div class="trait-track" title="${v.toFixed(2)} (avg ${info.traitMeans[k].toFixed(2)})"><span class="mean" style="left:${p(info.traitMeans[k])}"></span><span class="me" style="left:${p(v)}"></span></div>`;
    }).join('')}</div>
    <div class="subhead">Life so far</div>
    <ul class="lifelog">${info.log.map((e) => `<li><span class="t">Day ${Math.floor(e.tick / TICKS_PER_DAY)} ${String(e.tick % 24).padStart(2, '0')}:00</span> ${LOG_NAMES[e.code]}</li>`).join('')}</ul>
  `;
  const ic = host.querySelector<HTMLCanvasElement>('#insp-icon')!;
  const g = ic.getContext('2d')!;
  g.drawImage(icons.frames[info.sp][0], 4, 4, 80, 80);
  host.querySelector('#insp-close')!.addEventListener('click', () => select(0));
}

function select(id: number): void {
  renderer.selectedId = id;
  renderer.follow = id !== 0;
  send({ type: 'select', id });
  if (!id) renderInspect(null);
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------

function setSpeed(tps: number): void {
  if (tps !== 0) lastSpeed = tps;
  speed = tps;
  send({ type: 'speed', tps });
  twin?.worker.postMessage({ type: 'speed', tps } as ToWorker);
  document.querySelectorAll<HTMLButtonElement>('#controls [data-speed]').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.speed) === tps);
  });
  const pb = document.querySelector<HTMLButtonElement>('#controls [data-speed="0"]')!;
  pb.innerHTML = tps === 0 ? ICONS.play : ICONS.pause;
  pb.title = tps === 0 ? 'Play (Space)' : 'Pause (Space)';
}

$('#controls').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.step !== undefined) {
    setSpeed(0);
    send({ type: 'step', ticks: 1 });
    twin?.worker.postMessage({ type: 'step', ticks: 1 } as ToWorker);
    return;
  }
  const v = Number(b.dataset.speed);
  if (v === 0) setSpeed(speed === 0 ? lastSpeed : 0);
  else setSpeed(v);
});

function updateLegend(): void {
  const parts: string[] = [];
  if (renderer.showFear) parts.push('<div><span style="display:inline-block;width:40px;height:8px;border-radius:3px;background:linear-gradient(90deg,rgba(220,40,60,0.05),rgba(220,40,60,0.8));margin-right:6px;vertical-align:-1px"></span><b>Landscape of fear</b>: where predators roam and kills happen. Prey avoid red ground, so grass recovers there.</div>');
  if (renderer.showLineage) parts.push('<div><b>Bloodlines</b>: each colour is one bloodline (a shared Q-table). Watch strategies spread or die out.</div>');
  $('#legend').innerHTML = parts.join('<div style="height:6px"></div>');
  $('#legend').hidden = !parts.length;
  $('#legend').style.maxWidth = '300px';
}

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const bar = $('#toolbar');
  $('#map').classList.toggle('picking', t !== 'inspect');
  renderer.hoverCell = null;
  if (t === 'inspect') {
    bar.hidden = true;
    return;
  }
  const releasable = SPECIES.filter((s) => s.enabled || s.id === 8);
  const opts = releasable.map((s) => `<option value="${s.id}" ${s.id === toolSpecies ? 'selected' : ''}>${s.plural}</option>`).join('');
  const range = (id: string, min: number, max: number, v: number, label: string) => `<label>${label}<input id="${id}" type="range" min="${min}" max="${max}" value="${v}"/></label><span id="${id}-v">${v}</span>`;
  const html: Record<Tool, string> = {
    inspect: '',
    release: `<b>Release</b><select id="tb-sp">${opts}</select>${range('tb-n', 1, 30, toolCount, '×')}<span class="hint">Click the map</span>`,
    cull: `<b>Cull</b><select id="tb-sp"><option value="-1" ${toolSpecies === -1 ? 'selected' : ''}>All animals</option>${opts}</select>${range('tb-n', 2, 40, cullRadius, 'radius')}<span class="hint">Click the map</span>`,
    ignite: '<b>Ignite</b><span class="hint">Click dry grass or woodland. Wind carries it; water, walls and grazed ground stop it.</span>',
    rain: `<b>Rain</b>${range('tb-rain', 5, 60, toolOpt.rainR, 'radius')}<span class="hint">Click to soak an area and douse fires</span>`,
    drought: '<b>Drought</b><button class="btn" id="tb-go">Start a season of drought</button>',
    poison: '<b>Poison water</b><span class="hint">Click a lake or river. It spreads through connected water.</span>',
    pesticide: `<b>Pesticide</b>${range('tb-pest', 4, 40, toolOpt.pestR, 'radius')}<span class="hint">Insects die off; berries need them</span>`,
    plant: `<b>Plant</b><select id="tb-kind"><option value="0" ${toolOpt.plantKind === 0 ? 'selected' : ''}>Oaks</option><option value="1" ${toolOpt.plantKind === 1 ? 'selected' : ''}>Willows (near water)</option></select><span class="hint">Click the map</span>`,
    wall: '<b>Wall</b><span class="hint">Drag across the map to build a wall only birds can cross</span>',
    outbreak: `<b>Outbreak</b><select id="tb-path"><option value="1">Rabbit plague</option><option value="2">Mange (foxes, wolves)</option><option value="3">Bird flu (raptors, herons)</option></select><span class="hint">Click near a host</span>`,
    dam: `<b>Dam</b><select id="tb-dam"><option value="0">Build a dam</option><option value="1">Breach a dam</option></select><span class="hint">Click a narrow stream</span>`,
    food: `<b>Food drop</b><select id="tb-food"><option value="0">Berries</option><option value="1">A carcass</option></select><span class="hint">Click the map</span>`,
  };
  bar.innerHTML = html[t];
  bar.hidden = false;
  const on = (id: string, ev: string, fn: (v: string) => void) => {
    const el = bar.querySelector<HTMLInputElement>(`#${id}`);
    if (el) el.addEventListener(ev, () => {
      fn(el.value);
      const out = bar.querySelector(`#${id}-v`);
      if (out) out.textContent = el.value;
    });
  };
  on('tb-sp', 'change', (v) => (toolSpecies = Number(v)));
  on('tb-n', 'input', (v) => (t === 'release' ? (toolCount = Number(v)) : (cullRadius = Number(v))));
  on('tb-rain', 'input', (v) => (toolOpt.rainR = Number(v)));
  on('tb-pest', 'input', (v) => (toolOpt.pestR = Number(v)));
  on('tb-kind', 'change', (v) => (toolOpt.plantKind = Number(v)));
  on('tb-path', 'change', (v) => (toolOpt.pathogen = Number(v)));
  on('tb-food', 'change', (v) => (toolOpt.foodKind = Number(v)));
  on('tb-dam', 'change', (v) => (toolOpt.damMode = Number(v)));
  bar.querySelector('#tb-go')?.addEventListener('click', () => {
    if (!allowAction('drought')) return;
    send({ type: 'act', tool: 'drought', a: [] });
    toast('A dry season begins: little rain for 28 days');
    setTool('inspect');
  });
}

function toolRadius(): number {
  return tool === 'cull' ? cullRadius : tool === 'rain' ? toolOpt.rainR : tool === 'pesticide' ? toolOpt.pestR : tool === 'plant' ? 5 : tool === 'food' ? 4 : 3;
}

function useTool(wx: number, wy: number): void {
  if (!allowAction(tool)) return;
  switch (tool) {
    case 'release': {
      const sp = toolSpecies < 0 ? 7 : toolSpecies;
      send({ type: 'act', tool: 'release', a: [sp, wx, wy, toolCount] });
      toast(`Released ${toolCount} ${(toolCount === 1 ? SPECIES[sp].name : SPECIES[sp].plural).toLowerCase()}`);
      break;
    }
    case 'cull':
      send({ type: 'act', tool: 'cull', a: [toolSpecies, wx, wy, cullRadius] });
      break;
    case 'ignite':
      send({ type: 'act', tool: 'ignite', a: [wx, wy] });
      break;
    case 'rain':
      send({ type: 'act', tool: 'rain', a: [wx, wy, toolOpt.rainR] });
      break;
    case 'poison':
      send({ type: 'act', tool: 'poison', a: [wx, wy] });
      break;
    case 'pesticide':
      send({ type: 'act', tool: 'pesticide', a: [wx, wy, toolOpt.pestR] });
      break;
    case 'plant':
      send({ type: 'act', tool: 'plant', a: [toolOpt.plantKind, wx, wy] });
      break;
    case 'outbreak':
      send({ type: 'act', tool: 'outbreak', a: [toolOpt.pathogen, wx, wy] });
      break;
    case 'food':
      send({ type: 'act', tool: 'food', a: [toolOpt.foodKind, wx, wy] });
      break;
    case 'dam':
      send({ type: 'act', tool: toolOpt.damMode ? 'breach' : 'dam', a: [wx, wy] });
      break;
    default:
      break;
  }
}

$('#tools').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b || b.disabled) return;
  if (b.dataset.tool) setTool(b.dataset.tool as Tool);
  if (b.dataset.layer === 'fear') {
    renderer.showFear = !renderer.showFear;
    b.classList.toggle('on', renderer.showFear);
    send({ type: 'layers', fear: renderer.showFear });
  }
  if (b.dataset.layer === 'lineage') {
    renderer.showLineage = !renderer.showLineage;
    b.classList.toggle('on', renderer.showLineage);
  }
  updateLegend();
});

// map interaction: drag pans, click uses the tool, wheel zooms
const mapEl = $<HTMLCanvasElement>('#map');
let down: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
mapEl.addEventListener('pointerdown', (e) => {
  mapEl.setPointerCapture(e.pointerId);
  down = { x: e.clientX, y: e.clientY, cx: renderer.cam.x, cy: renderer.cam.y, moved: false };
  if (tool === 'wall') {
    const r = mapEl.getBoundingClientRect();
    const [wx, wy] = renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
    renderer.wallDraft = [wx, wy, wx, wy];
  }
});
mapEl.addEventListener('pointermove', (e) => {
  const r = mapEl.getBoundingClientRect();
  const [wx, wy] = renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  if (tool !== 'inspect' && tool !== 'wall' && tool !== 'drought') renderer.hoverCell = { x: wx, y: wy, r: toolRadius() };
  if (!down) return;
  if (tool === 'wall' && renderer.wallDraft) {
    renderer.wallDraft[2] = wx;
    renderer.wallDraft[3] = wy;
    return;
  }
  const dx = e.clientX - down.x;
  const dy = e.clientY - down.y;
  if (!down.moved && dx * dx + dy * dy > 16) {
    down.moved = true;
    renderer.follow = false;
  }
  if (down.moved) {
    renderer.atFit = false;
    renderer.cam.x = down.cx - dx / renderer.cam.scale;
    renderer.cam.y = down.cy - dy / renderer.cam.scale;
    renderer.clampCam();
  }
});
mapEl.addEventListener('pointerup', (e) => {
  if (!down) return;
  const wasClick = !down.moved;
  down = null;
  if (tool === 'wall' && renderer.wallDraft) {
    const [a, b, c, d] = renderer.wallDraft;
    renderer.wallDraft = null;
    if (Math.hypot(c - a, d - b) >= 2 && allowAction('wall')) send({ type: 'act', tool: 'wall', a: [a, b, c, d] });
    return;
  }
  if (!wasClick) return;
  const r = mapEl.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const [wx, wy] = renderer.toWorld(px, py);
  if (tool === 'inspect') select(renderer.pick(px, py));
  else useTool(wx, wy);
});
mapEl.addEventListener('pointerleave', () => (renderer.hoverCell = null));
mapEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = mapEl.getBoundingClientRect();
    renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);
document.querySelector('.zoom')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const z = b.dataset.z;
  if (z === 'director') {
    toggleDirector();
    return;
  }
  if (z === 'fit') {
    renderer.follow = false;
    renderer.fit();
  } else renderer.zoomAt(renderer.viewW / 2, renderer.viewH / 2, z === 'in' ? 1.5 : 1 / 1.5);
});

$('#scale').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  chart.log = b.dataset.scale === 'log';
  $('#scale').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  chartDirty = true;
});

timeline.onPreview = (day) => send({ type: 'preview', day });
timeline.onSeek = (tick) => {
  send({ type: 'seek', tick });
};
timeline.onHover = (text) => ($('#tl-hover').textContent = text);

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea, dialog')) return;
  if (e.key === ' ') {
    e.preventDefault();
    setSpeed(speed === 0 ? lastSpeed : 0);
  } else if (e.key === 'ArrowRight') {
    setSpeed(0);
    send({ type: 'step', ticks: e.shiftKey ? 24 : 1 });
  } else if (e.key === '1') setSpeed(24);
  else if (e.key === '2') setSpeed(96);
  else if (e.key === '3') setSpeed(384);
  else if (e.key === '4') setSpeed(-1);
  else if (e.key === 'i') setTool('inspect');
  else if (e.key === 'r') setTool('release');
  else if (e.key === 'c') setTool('cull');
  else if (e.key === 'f') renderer.follow = !!renderer.selectedId && !renderer.follow;
  else if (e.key === 'Escape') select(0);
  else if (e.key === '?') dlgHelp.showModal();
  else if (e.key === 'd') toggleDirector();
});

// theme
const themes = ['auto', 'light', 'dark'] as const;
let themeIdx = 0;
try {
  themeIdx = Math.max(0, themes.indexOf((localStorage.getItem('thicket-theme') as never) ?? 'auto'));
} catch {
  themeIdx = 0;
}
function applyTheme(): void {
  const t = themes[themeIdx];
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#btn-theme').title = `Theme: ${t}`;
  chartDirty = true;
}
$('#btn-theme').addEventListener('click', () => {
  themeIdx = (themeIdx + 1) % 3;
  try {
    localStorage.setItem('thicket-theme', themes[themeIdx]);
  } catch {
    /* storage unavailable */
  }
  applyTheme();
});

// new world dialog
const dlgNew = $<HTMLDialogElement>('#dlg-new');
$('#btn-new').addEventListener('click', () => {
  $<HTMLSelectElement>('#nw-preset').value = world.preset;
  $<HTMLInputElement>('#nw-seed').value = String(randomSeed());
  $<HTMLSelectElement>('#nw-instinct').value = world.instinct;
  dlgNew.showModal();
});
$('#nw-dice').addEventListener('click', () => ($<HTMLInputElement>('#nw-seed').value = String(randomSeed())));
$('#nw-cancel').addEventListener('click', () => dlgNew.close());
$('#nw-go').addEventListener('click', () => {
  dlgNew.close();
  challenge = null;
  renderChallenge('');
  history.replaceState(null, '', location.pathname);
  startWorld({
    seed: Number($<HTMLInputElement>('#nw-seed').value) >>> 0,
    preset: $<HTMLSelectElement>('#nw-preset').value as Preset,
    instinct: $<HTMLSelectElement>('#nw-instinct').value as Instinct,
  });
});

// call it: predict the first extinction
let call: { sp: number; day: number; madeOn: number } | null = null;
let firstLoss: { sp: number; day: number } | null = null;
$('#btn-callit').addEventListener('click', () => {
  const sel = $<HTMLSelectElement>('#ci-sp');
  sel.innerHTML = SPECIES.filter((sp) => sp.enabled && (lastFrame?.counts[sp.id] ?? 0) > 0).map((sp) => `<option value="${sp.id}">${sp.plural}</option>`).join('');
  const today = Math.floor((lastFrame?.tick ?? 0) / TICKS_PER_DAY);
  $<HTMLInputElement>('#ci-day').value = String(today + 120);
  $<HTMLDialogElement>('#dlg-callit').showModal();
});
$('#ci-cancel').addEventListener('click', () => $<HTMLDialogElement>('#dlg-callit').close());
$('#ci-go').addEventListener('click', () => {
  $<HTMLDialogElement>('#dlg-callit').close();
  call = { sp: Number($<HTMLSelectElement>('#ci-sp').value), day: Number($<HTMLInputElement>('#ci-day').value), madeOn: Math.floor((lastFrame?.tick ?? 0) / TICKS_PER_DAY) };
  firstLoss = null;
  $('#btn-callit').innerHTML = `${ICONS.target}<span class="lbl">${SPECIES[call.sp].plural} by day ${call.day}</span>`;
  toast(`Called it: ${SPECIES[call.sp].plural.toLowerCase()} go first, by day ${call.day}.`);
  if (speed === 0) setSpeed(lastSpeed);
});
function judgeCall(sp: number, day: number): void {
  if (!call || firstLoss) return;
  firstLoss = { sp, day };
  const right = sp === call.sp;
  const onTime = day <= call.day;
  $('#res-title').textContent = right ? (onTime ? 'Called it.' : 'Right species, wrong day.') : 'Not this time.';
  $('#res-body').innerHTML = `The first species lost was <b>${SPECIES[sp].plural.toLowerCase()}</b>, on day ${day}. You called <b>${SPECIES[call.sp].plural.toLowerCase()}</b> by day ${call.day}${right ? (onTime ? `, with ${call.day - day} day${call.day - day === 1 ? '' : 's'} to spare` : `, ${day - call.day} day${day - call.day === 1 ? '' : 's'} late`) : ''}.`;
  setSpeed(0);
  $<HTMLDialogElement>('#dlg-result').showModal();
  $('#btn-callit').innerHTML = `${ICONS.target}<span class="lbl">Call it</span>`;
}
$('#res-close').addEventListener('click', () => $<HTMLDialogElement>('#dlg-result').close());
$('#res-share').addEventListener('click', () => {
  $<HTMLDialogElement>('#dlg-result').close();
  send({ type: 'share' });
});

// director: every few seconds the camera cuts to the most dramatic thing on the map
let director = false;
let directorNext = 0;
function toggleDirector(): void {
  director = !director;
  $('#btn-director').style.background = director ? 'var(--accent-soft)' : '';
  directorNext = 0;
  if (!director) {
    renderer.followId = 0;
    renderer.follow = !!renderer.selectedId;
  }
}
function directorTick(now: number): void {
  if (!director || !lastFrame || now < directorNext) return;
  directorNext = now + 7000;
  const f = lastFrame;
  const W = renderer.terrain?.w ?? 384;
  const zoomTo = (scale: number) => {
    renderer.atFit = false;
    renderer.cam.scale = Math.max(renderer.cam.scale * 0.6, Math.min(scale, renderer.cam.scale * 2.5));
    renderer.clampCam();
  };
  // 1. a fire
  if (f.fire.length) {
    let sx = 0;
    let sy = 0;
    for (const c of f.fire) {
      sx += c % W;
      sy += Math.floor(c / W);
    }
    renderer.followId = 0;
    renderer.follow = false;
    renderer.cam.x = sx / f.fire.length;
    renderer.cam.y = sy / f.fire.length;
    zoomTo(7);
    return;
  }
  // 2. the last few of a species, 3. a chase
  const scarce = SPECIES.filter((sp) => f.counts[sp.id] > 0 && f.counts[sp.id] <= 3).map((sp) => sp.id);
  let pick = -1;
  const hunters: number[] = [];
  for (let k = 0; k < f.n; k++) {
    const bits = f.u[k * 2 + 1];
    if (bits & 512) continue; // underground
    const sp = bits & 31;
    if (scarce.includes(sp)) {
      pick = k;
      break;
    }
    if (((bits >> 5) & 15) === 5) hunters.push(k);
  }
  if (pick < 0 && hunters.length) pick = hunters[Math.floor(Math.random() * hunters.length)];
  if (pick < 0) return;
  renderer.followId = f.u[pick * 2];
  renderer.follow = true;
  zoomTo(9);
}

// help
const dlgHelp = $<HTMLDialogElement>('#dlg-help');
$('#btn-help').addEventListener('click', () => dlgHelp.showModal());
$('#help-close').addEventListener('click', () => dlgHelp.close());
try {
  if (!localStorage.getItem('thicket-seen-help')) {
    localStorage.setItem('thicket-seen-help', '1');
    setTimeout(() => dlgHelp.showModal(), 400);
  }
} catch {
  /* storage unavailable: skip the first-visit help */
}

// challenges
let challenge: { def: Challenge; used: number; startCounts: number[] | null; startOaks: number; done: boolean } | null = null;
$('#btn-modes').addEventListener('click', () => {
  $('#play-list').innerHTML = CHALLENGES.map((c) => `<div class="sp-row" data-ch="${c.id}" style="grid-template-columns:1fr auto;padding:8px 10px;margin:0 0 6px;border:1px solid var(--line)">
    <div><div style="font-weight:600">${c.title}</div><div class="hint">${c.goal}</div></div>
    <div class="hint" style="text-align:right;white-space:nowrap">${c.budget} actions<br/>${PRESETS.find((p) => p.id === c.preset)?.name}</div></div>`).join('');
  $<HTMLDialogElement>('#dlg-play').showModal();
});
$('#play-close').addEventListener('click', () => $<HTMLDialogElement>('#dlg-play').close());
$('#play-list').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-ch]');
  if (!row) return;
  const def = CHALLENGES.find((c) => c.id === row.dataset.ch)!;
  $<HTMLDialogElement>('#dlg-play').close();
  history.replaceState(null, '', location.pathname);
  endTwin();
  startWorld({ seed: def.seed, preset: def.preset, instinct: 'wild' }, { log: def.setup.map((x) => ({ tick: 0, tool: x.tool, a: x.a })) });
  challenge = { def, used: 0, startCounts: null, startOaks: 0, done: false };
  renderChallenge('Starting…');
});

function renderChallenge(progress: string): void {
  const host = $('#challenge');
  if (!challenge) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const c = challenge;
  host.innerHTML = `<h3>Challenge <span class="aside">${c.used} / ${c.def.budget} actions used</span></h3>
    <div style="font-family:var(--display);font-size:17px;font-weight:650;margin-bottom:2px">${c.def.title}</div>
    <div class="hint" style="margin-bottom:8px">${c.def.goal}</div>
    <div style="font-size:12.5px">${progress}</div>
    <div class="dialog-actions" style="margin-top:8px"><button class="btn" id="ch-quit">Leave challenge</button></div>`;
  host.querySelector('#ch-quit')!.addEventListener('click', () => {
    challenge = null;
    renderChallenge('');
    document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => (b.disabled = false));
  });
  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => {
    const t = b.dataset.tool!;
    b.disabled = t !== 'inspect' && !c.def.allow.includes(t);
  });
}

function checkChallenge(f: Frame): void {
  if (!challenge || challenge.done) return;
  if (!challenge.startCounts) {
    challenge.startCounts = f.counts.slice();
    challenge.startOaks = f.oaks;
  }
  const r = challenge.def.check({ day: Math.floor(f.tick / TICKS_PER_DAY), counts: f.counts, startCounts: challenge.startCounts, oaks: f.oaks, startOaks: challenge.startOaks, sick: f.sick, used: challenge.used });
  renderChallenge(r.status === 'running' ? r.progress : r.status === 'won' ? `<b>Won.</b> ${r.progress}` : `<b>Lost.</b> ${r.why}`);
  if (r.status !== 'running') {
    challenge.done = true;
    setSpeed(0);
    $('#res-title').textContent = r.status === 'won' ? `${challenge.def.title}: done` : `${challenge.def.title}: not this time`;
    $('#res-body').innerHTML = `${r.status === 'won' ? r.progress : r.why} You used ${challenge.used} of ${challenge.def.budget} actions.`;
    $<HTMLDialogElement>('#dlg-result').showModal();
  }
}

/** Gate an intervention through the active challenge's rules. */
function allowAction(t: string): boolean {
  if (!challenge || challenge.done) return true;
  if (!challenge.def.allow.includes(t)) {
    toast('That tool is locked in this challenge.');
    return false;
  }
  if (challenge.used >= challenge.def.budget) {
    toast('No actions left in this challenge.');
    return false;
  }
  challenge.used++;
  return true;
}

// clip recording
const clip = new ClipRecorder();
$('#btn-clip').addEventListener('click', () => {
  if (clip.recording) {
    clip.cancel();
    $('#rec').hidden = true;
    return;
  }
  $<HTMLDialogElement>('#dlg-clip').showModal();
});
$('#clip-cancel').addEventListener('click', () => $<HTMLDialogElement>('#dlg-clip').close());
$('#clip-go').addEventListener('click', () => {
  $<HTMLDialogElement>('#dlg-clip').close();
  clip.start(Number($<HTMLSelectElement>('#clip-len').value), $<HTMLSelectElement>('#clip-fmt').value === 'p');
  $('#rec').hidden = false;
  if (speed === 0) setSpeed(lastSpeed);
});
clip.onTick = (left) => ($('#rec').textContent = left > 0 ? `● REC ${left}s · click Clip to stop` : '● Finishing…');
clip.onDone = (blob, ext) => {
  $('#rec').hidden = true;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `thicket-${world.preset}-${world.seed}-day${Math.floor((lastFrame?.tick ?? 0) / TICKS_PER_DAY)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`Clip saved (${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()})`);
};
function clipInfo() {
  const last = narrator.history[narrator.history.length - 1];
  const fresh = last && lastFrame && Math.floor(lastFrame.tick / TICKS_PER_DAY) - last.day <= 6;
  return {
    when: $('.calendar .when').textContent ?? '',
    caption: fresh ? last.html.replace(/<[^>]+>/g, '') : '',
    counts: lastFrame?.counts ?? [],
    seedLine: `${PRESETS.find((p) => p.id === world.preset)?.name} · seed ${world.seed}`,
  };
}

// twin worlds: an untouched copy of this world from the moment you split it
let twin: { worker: Worker; renderer: Renderer; rows: StatsRow[]; frame: Frame | null; target: number } | null = null;
function endTwin(): void {
  twinEnd();
}
$('#play-twin').addEventListener('click', () => {
  $<HTMLDialogElement>('#dlg-play').close();
  send({ type: 'share', purpose: 'twin' });
});
function twinStart(p: import('./sim/protocol').SharePayload): void {
  twinEnd();
  const wk = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
  const r2 = new Renderer($<HTMLCanvasElement>('#map2'), SPECIES.map((sp) => sp.color));
  r2.cam = renderer.cam; // one camera for both halves
  twin = { worker: wk, renderer: r2, rows: [], frame: null, target: p.tick };
  $('#stage').classList.add('split');
  $('#map2').hidden = false;
  $('#lbl-a').hidden = false;
  $('#lbl-b').hidden = false;
  wk.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (!twin) return;
    if (m.type === 'ready') {
      r2.setTerrain(generateTerrain(m.preset, m.seed, m.w, m.h));
      r2.cam = renderer.cam;
      wk.postMessage({ type: 'step', ticks: p.tick } as ToWorker);
      wk.postMessage({ type: 'speed', tps: speed } as ToWorker);
    } else if (m.type === 'frame') {
      twin.frame = m;
      r2.pushFrame(m.n, m.f, m.u, m.tick);
      r2.carcasses = m.carcasses;
      r2.warrens = m.warrens;
      if (m.trees) r2.trees = m.trees;
      r2.fire = m.fire;
      r2.dams = m.dams;
      r2.weather = m.weather;
      r2.wind = m.wind;
    } else if (m.type === 'grass') r2.setGrass(m.data, undefined, m.scar, m.wall, m.toxin);
    else if (m.type === 'terrain') r2.updateTerrain(m.ttype, m.depth);
    else if (m.type === 'stats') {
      if (m.reset) twin.rows = [];
      for (const row of m.rows) twin.rows[row.day] = row;
      chart.rowsB = twin.rows;
      chartDirty = true;
    }
  };
  wk.postMessage({ type: 'new', world: { seed: p.seed, preset: p.preset, instinct: p.instinct, log: p.log } } as ToWorker);
  renderer.resize();
  toast('Twin created. Your actions now change only the left world.');
}
function twinEnd(): void {
  if (!twin) return;
  twin.worker.terminate();
  twin = null;
  chart.rowsB = null;
  chartDirty = true;
  $('#stage').classList.remove('split');
  $('#map2').hidden = true;
  $('#lbl-a').hidden = true;
  $('#lbl-b').hidden = true;
  requestAnimationFrame(() => renderer.resize());
}
$('#twin-close').addEventListener('click', () => twinEnd());

// share dialog
$('#btn-share').addEventListener('click', () => send({ type: 'share' }));
$('#share-close').addEventListener('click', () => $<HTMLDialogElement>('#dlg-share').close());
$('#share-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>('#share-url').value);
    toast('Link copied');
  } catch {
    $<HTMLTextAreaElement>('#share-url').select();
  }
});

function toast(text: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** Today's shared world: everyone gets the same seed and landscape for the date. */
function dailyWorld(): { seed: number; preset: Preset; label: string } {
  const d = new Date();
  const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = key >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  const presets: Preset[] = ['valley', 'lakes', 'islands', 'plain', 'highlands'];
  const days = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return { seed: (h ^ (h >>> 16)) % 1000000, preset: presets[days % presets.length], label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) };
}
$('#btn-daily').addEventListener('click', () => {
  const dw = dailyWorld();
  challenge = null;
  renderChallenge('');
  history.replaceState(null, '', location.pathname);
  startWorld({ seed: dw.seed, preset: dw.preset, instinct: 'wild' });
  toast(`Daily world for ${dw.label}: ${PRESETS.find((p) => p.id === dw.preset)?.name}, seed ${dw.seed}. Everyone gets this one today.`);
});

function randomSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

function startWorld(w: { seed: number; preset: Preset; instinct: Instinct }, extra?: { log: never[] | any[]; verify?: { tick: number; hash: string } }): void {
  twinEnd();
  rows = [];
  chart.rows = rows;
  timeline.rows = rows;
  timeline.marks = [];
  send({ type: 'new', world: { ...w, log: extra?.log, verify: extra?.verify } });
}

// ---------------------------------------------------------------------------
// frame loop
// ---------------------------------------------------------------------------

let chartDirty = true;
let lastSlow = 0;
function frame(): void {
  directorTick(performance.now());
  renderer.draw();
  if (twin) twin.renderer.draw();
  if (clip.recording) clip.frame(renderer.canvas, clipInfo());
  const now = performance.now();
  if (now - lastSlow > 100) {
    lastSlow = now;
    timeline.draw();
    if (chartDirty) {
      chart.draw();
      chartDirty = false;
    }
  }
  requestAnimationFrame(frame);
}

new ResizeObserver(() => {
  renderer.resize();
  twin?.renderer.resize();
  chartDirty = true;
}).observe($('#stage'));

if (import.meta.env.DEV) (window as unknown as { __thicket: unknown }).__thicket = { renderer, chart, timeline };

applyTheme();
setTool('inspect');
setSpeed(24);
requestAnimationFrame(frame);

// boot: a shared world from the URL, or a fresh one
(async () => {
  const shared = location.hash ? await decodeShare(location.hash).catch(() => null) : null;
  if (shared) {
    startWorld({ seed: shared.seed, preset: shared.preset, instinct: shared.instinct }, { log: shared.log, verify: { tick: shared.tick, hash: shared.hash } });
    toast(`Replaying a shared world to day ${Math.floor(shared.tick / TICKS_PER_DAY)}…`);
  } else {
    startWorld({ seed: randomSeed(), preset: 'valley', instinct: 'wild' });
  }
})();

void seeking;
void lastFrame;
