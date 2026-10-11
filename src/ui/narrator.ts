// Rules-based narrator: turns engine events and daily stats into short captions.
// Deterministic (templates, no language model), so replays narrate identically.

import type { StatsRow } from '../sim/protocol';
import type { SimEvent } from '../sim/world';
import { SPECIES } from '../sim/species';
import { DAYS_PER_SEASON, SEASON_NAMES, TICKS_PER_DAY } from '../sim/constants';

export interface Caption {
  day: number;
  html: string;
}

const lower = (s: string) => s.toLowerCase();

export class Narrator {
  history: Caption[] = [];
  private lastNote = new Map<string, number>();
  constructor(private readonly host: HTMLElement) {}

  reset(): void {
    this.history = [];
    this.lastNote.clear();
    this.host.innerHTML = '';
  }

  private say(day: number, html: string, key: string, gapDays = 0): void {
    const last = this.lastNote.get(key);
    if (last !== undefined && day - last < gapDays) return;
    this.lastNote.set(key, day);
    const cap = { day, html };
    this.history.push(cap);
    const el = document.createElement('div');
    el.className = 'caption';
    el.innerHTML = `<span class="day">Day ${day}</span>${html}`;
    this.host.prepend(el);
    while (this.host.children.length > 3) this.host.lastElementChild!.remove();
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 700);
    }, 7000);
  }

  /** A caption from outside the engine's event stream (weather, interface). */
  note(day: number, html: string, key: string, gapDays: number): void {
    this.say(day, html, key, gapDays);
  }

  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      const day = Math.floor(e.tick / TICKS_PER_DAY);
      const sp = SPECIES[e.sp];
      if (e.kind === 'extinct') this.say(day, `The last <b>${lower(sp.name)}</b> is gone.`, `ext${e.sp}`, 1);
      else if (e.kind === 'ceiling') this.say(day, 'The world is full. Births pause for the most numerous species.', 'ceil', 14);
      else if (e.kind === 'fire') this.say(day, 'Lightning starts a <b>fire</b>.', `fire${day}`, 2);
      else if (e.kind === 'outbreak') this.say(day, `<b>${['', 'Rabbit plague', 'Mange', 'Bird flu'][e.v ?? 0]}</b> breaks out among the ${lower(sp.plural)}.`, `ob${e.v}`, 10);
      else if (e.kind === 'dam') this.say(day, `Beavers dam a stream. A new pond floods <b>${e.v} cells</b>.`, `dam${day}`, 3);
      else if (e.kind === 'dam-break') this.say(day, `A beaver dam gives way. The pond drains to marsh.`, `dambreak${day}`, 3);
      else if (e.kind === 'lineage') this.say(day, `A new <b>${lower(sp.name)}</b> bloodline splits off.`, `lin${e.sp}`, 21);
    }
  }

  onRow(row: StatsRow, rows: StatsRow[]): void {
    const day = row.day;
    if (day > 0 && day % DAYS_PER_SEASON === 0) {
      const season = SEASON_NAMES[(day / DAYS_PER_SEASON) % 4];
      const text = { Spring: 'Spring. The grass comes back.', Summer: 'Summer. Long days for the day hunters.', Autumn: 'Autumn. Breeding stops for the small grazers.', Winter: 'Winter sets in. Food will be short.' }[season];
      this.say(day, text, `season${day}`);
    }
    const past = rows[day - 7];
    if (!past) return;
    for (const sp of SPECIES) {
      const now = row.counts[sp.id];
      const then = past.counts[sp.id];
      if (then >= 20 && now >= then * 2) this.say(day, `<b>${sp.plural}</b> have doubled in a week, to ${now}.`, `up${sp.id}`, 21);
      else if (then >= 20 && now <= then * 0.5 && now > 0) this.say(day, `<b>${sp.plural}</b> halved in a week, down to ${now}.`, `down${sp.id}`, 21);
    }
  }
}
