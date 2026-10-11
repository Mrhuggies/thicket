// Procedural animal sprites, drawn once into offscreen canvases. Side view, facing right.
// Two frames per species: a stride frame and a gather frame (wings up / wings down for birds).

import { Sp } from '../sim/species';

export const SPRITE_PX = 64;
const INK = 'rgba(28, 22, 16, 0.9)';

type Draw = (g: CanvasRenderingContext2D, frame: number) => void;

function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function fillStroke(g: CanvasRenderingContext2D, fill: string, lw = 3): void {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke();
}

function legs(g: CanvasRenderingContext2D, xs: number[], top: number, len: number, frame: number, color = INK, w = 3.2): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  xs.forEach((x, k) => {
    const swing = (k % 2 === frame ? 1 : -1) * 4;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + swing, top + len);
    g.stroke();
  });
}

const draws: Partial<Record<Sp, Draw>> = {
  [Sp.Rabbit]: (g, f) => {
    legs(g, [22, 40], 40, 9, f);
    blob(g, 30, 36, 15, 10);
    fillStroke(g, '#c7b394');
    blob(g, 15, 33, 4, 4); // tail
    fillStroke(g, '#f4efe6', 2);
    blob(g, 44, 28, 8, 7);
    fillStroke(g, '#c7b394');
    blob(g, 42, 15, 3, 9, -0.25); // ears
    fillStroke(g, '#bba585', 2.5);
    blob(g, 47, 16, 3, 9, 0.15);
    fillStroke(g, '#bba585', 2.5);
    g.fillStyle = INK;
    g.fillRect(47, 26, 2.5, 2.5);
  },
  [Sp.Mouse]: (g, f) => {
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(18, 38);
    g.quadraticCurveTo(6, 36 + (f ? 4 : -2), 4, 30);
    g.stroke();
    legs(g, [26, 38], 40, 5, f, INK, 2.5);
    blob(g, 31, 36, 13, 8);
    fillStroke(g, '#8f877b');
    blob(g, 43, 33, 7, 6);
    fillStroke(g, '#8f877b');
    blob(g, 41, 26, 4.5, 4.5);
    fillStroke(g, '#c9a9a0', 2);
    g.fillStyle = INK;
    g.fillRect(46, 31, 2.5, 2.5);
  },
  [Sp.Squirrel]: (g, f) => {
    g.beginPath(); // big bushy tail
    g.moveTo(22, 40);
    g.quadraticCurveTo(4, 36, 10, 14 + (f ? 2 : 0));
    g.quadraticCurveTo(22, 14, 22, 30);
    g.closePath();
    fillStroke(g, '#b8693c');
    legs(g, [28, 40], 40, 6, f, INK, 2.8);
    blob(g, 33, 36, 11, 8);
    fillStroke(g, '#b0623a');
    blob(g, 44, 28, 6.5, 6);
    fillStroke(g, '#b0623a');
    g.beginPath();
    g.moveTo(42, 23); g.lineTo(43, 17); g.lineTo(46, 22);
    fillStroke(g, '#9c5532', 2);
    blob(g, 34, 39, 6, 3.5);
    fillStroke(g, '#ead8c2', 1.5);
    g.fillStyle = INK;
    g.fillRect(46, 26, 2.5, 2.5);
  },
  [Sp.Frog]: (g, f) => {
    g.strokeStyle = INK;
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.beginPath(); // folded hind legs
    g.moveTo(22, 40);
    g.lineTo(f ? 12 : 16, 46);
    g.lineTo(f ? 22 : 24, 48);
    g.stroke();
    blob(g, 32, 38, 13, 9);
    fillStroke(g, '#5f8a3c');
    blob(g, 42, 33, 7, 6);
    fillStroke(g, '#6a9944');
    blob(g, 44, 27, 3.2, 3.2);
    fillStroke(g, '#e9e2b0', 1.6);
    g.fillStyle = INK;
    g.fillRect(44, 26, 2, 2);
    blob(g, 30, 40, 7, 3.5);
    fillStroke(g, '#d7d29a', 1.4);
  },
  [Sp.Fish]: (g, f) => {
    g.beginPath(); // tail
    g.moveTo(16, 32);
    g.lineTo(5, f ? 24 : 26);
    g.lineTo(5, f ? 40 : 38);
    g.closePath();
    fillStroke(g, '#8fa5b2', 2.4);
    blob(g, 32, 32, 17, 8);
    fillStroke(g, '#9fb4c0');
    g.strokeStyle = 'rgba(60,80,95,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(20, 32);
    g.lineTo(44, 32);
    g.stroke();
    g.fillStyle = INK;
    g.fillRect(42, 29, 2.5, 2.5);
  },
  [Sp.Snake]: (g, f) => {
    g.strokeStyle = INK;
    g.lineWidth = 7.5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const wave = f ? 6 : -6;
    g.beginPath();
    g.moveTo(6, 36);
    g.bezierCurveTo(16, 36 + wave, 24, 36 - wave, 34, 36);
    g.bezierCurveTo(42, 36 + wave, 48, 34, 52, 32);
    g.stroke();
    g.strokeStyle = '#6d7a3a';
    g.lineWidth = 5;
    g.stroke();
    blob(g, 54, 31, 5, 3.6);
    fillStroke(g, '#6d7a3a', 2);
    g.fillStyle = INK;
    g.fillRect(55, 29, 2, 2);
  },
  [Sp.Heron]: (g, f) => {
    const up = f === 0;
    g.beginPath();
    g.moveTo(32, 30);
    g.quadraticCurveTo(14, up ? 12 : 26, 0, up ? 18 : 30);
    g.quadraticCurveTo(16, 36, 32, 36);
    g.quadraticCurveTo(48, 36, 64, up ? 18 : 30);
    g.quadraticCurveTo(50, up ? 12 : 26, 32, 30);
    fillStroke(g, '#8e9aa6');
    blob(g, 32, 36, 4.5, 12);
    fillStroke(g, '#c9d0d6');
    g.strokeStyle = INK;
    g.lineWidth = 2.4;
    g.beginPath(); // neck tucked, long bill
    g.moveTo(32, 25);
    g.lineTo(32, 14);
    g.stroke();
    g.strokeStyle = '#d4a23a';
    g.beginPath();
    g.moveTo(32, 14);
    g.lineTo(32, 4);
    g.stroke();
    g.strokeStyle = INK;
    g.beginPath(); // trailing legs
    g.moveTo(30, 47);
    g.lineTo(29, 60);
    g.moveTo(34, 47);
    g.lineTo(35, 60);
    g.stroke();
  },
  [Sp.Bear]: (g, f) => {
    legs(g, [18, 25, 40, 47], 38, 14, f, '#2a1c14', 6);
    blob(g, 32, 32, 21, 13);
    fillStroke(g, '#5a3d2c');
    blob(g, 30, 22, 9, 6);
    fillStroke(g, '#5a3d2c');
    blob(g, 51, 28, 9, 8);
    fillStroke(g, '#5f4230');
    blob(g, 47, 19, 3, 3);
    fillStroke(g, '#4d3426', 2);
    blob(g, 58, 31, 4, 3);
    fillStroke(g, '#a07e62', 1.8);
    g.fillStyle = INK;
    g.fillRect(53, 25, 2.6, 2.6);
  },
  [Sp.Beaver]: (g, f) => {
    g.beginPath(); // flat tail
    g.ellipse(10, 40, 9, 4, 0.2, 0, Math.PI * 2);
    fillStroke(g, '#3d2c1e', 2.4);
    legs(g, [26, 40], 40, 6, f, INK, 3);
    blob(g, 32, 35, 16, 10);
    fillStroke(g, '#6b4a2e');
    blob(g, 47, 31, 8, 7);
    fillStroke(g, '#73502f');
    g.fillStyle = '#f1e2b8';
    g.fillRect(51, 35, 3, 4);
    g.fillStyle = INK;
    g.fillRect(50, 28, 2.5, 2.5);
  },
  [Sp.Cat]: (g, f) => {
    g.strokeStyle = INK;
    g.lineWidth = 3.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(16, 34);
    g.quadraticCurveTo(6, 30, 8, f ? 16 : 20);
    g.stroke();
    g.strokeStyle = '#5a5a5a';
    g.lineWidth = 2.2;
    g.stroke();
    legs(g, [22, 26, 38, 42], 38, 11, f, INK, 3);
    blob(g, 31, 34, 14, 8);
    fillStroke(g, '#5a5a5a');
    blob(g, 46, 28, 7, 6.5);
    fillStroke(g, '#5f5f5f');
    g.beginPath();
    g.moveTo(41, 24); g.lineTo(42, 16); g.lineTo(46, 22);
    g.moveTo(47, 22); g.lineTo(51, 16); g.lineTo(52, 25);
    fillStroke(g, '#5a5a5a', 2);
    g.fillStyle = '#d9cf6a';
    g.fillRect(47, 26, 3, 2.5);
  },
  [Sp.Deer]: (g, f) => {
    legs(g, [18, 24, 38, 44], 36, 18, f, '#5a3d27', 3.6);
    blob(g, 31, 32, 18, 10);
    fillStroke(g, '#a8754a');
    blob(g, 14, 30, 4, 5);
    fillStroke(g, '#f1e8da', 2);
    g.beginPath();
    g.moveTo(44, 28);
    g.lineTo(50, 14);
    g.lineTo(55, 16);
    g.lineTo(50, 32);
    g.closePath();
    fillStroke(g, '#a8754a');
    blob(g, 53, 14, 6, 4.5, 0.3);
    fillStroke(g, '#a8754a');
    g.strokeStyle = '#5a3d27';
    g.lineWidth = 2.5;
    g.beginPath(); // antlers
    g.moveTo(51, 10); g.lineTo(48, 3); g.moveTo(49, 6); g.lineTo(45, 5);
    g.moveTo(54, 10); g.lineTo(57, 3); g.moveTo(56, 6); g.lineTo(60, 5);
    g.stroke();
    g.fillStyle = INK;
    g.fillRect(55, 12, 2.5, 2.5);
  },
  [Sp.Fox]: (g, f) => {
    g.beginPath(); // tail
    g.moveTo(16, 32);
    g.quadraticCurveTo(2, 30 + (f ? 3 : -3), 4, 42);
    g.quadraticCurveTo(12, 40, 18, 36);
    fillStroke(g, '#d0672f');
    blob(g, 5, 41, 3, 3);
    fillStroke(g, '#f6efe4', 1.5);
    legs(g, [22, 26, 38, 42], 38, 12, f, '#3a2416', 3.2);
    blob(g, 30, 34, 15, 8);
    fillStroke(g, '#d0672f');
    g.beginPath(); // head
    g.moveTo(42, 26);
    g.lineTo(58, 32);
    g.lineTo(44, 38);
    g.closePath();
    fillStroke(g, '#d0672f');
    g.beginPath();
    g.moveTo(43, 27); g.lineTo(44, 18); g.lineTo(49, 27);
    fillStroke(g, '#c45d27', 2.5);
    blob(g, 50, 35, 5, 2.5);
    fillStroke(g, '#f6efe4', 1.5);
    g.fillStyle = INK;
    g.fillRect(49, 29, 2.5, 2.5);
  },
  [Sp.Wolf]: (g, f) => {
    g.beginPath();
    g.moveTo(15, 30);
    g.quadraticCurveTo(4, 36 + (f ? 2 : -2), 6, 44);
    g.lineTo(16, 36);
    fillStroke(g, '#6f7179');
    legs(g, [19, 24, 40, 45], 36, 16, f, '#2f3035', 3.6);
    blob(g, 31, 31, 18, 10);
    fillStroke(g, '#7d7f86');
    g.beginPath();
    g.moveTo(44, 22);
    g.lineTo(61, 30);
    g.lineTo(46, 37);
    g.closePath();
    fillStroke(g, '#8a8c93');
    g.beginPath();
    g.moveTo(45, 23); g.lineTo(46, 14); g.lineTo(51, 24);
    fillStroke(g, '#6f7179', 2.5);
    g.fillStyle = INK;
    g.fillRect(52, 27, 2.6, 2.6);
  },
  [Sp.Hawk]: (g, f) => {
    // top-down glide with wing frames
    const up = f === 0;
    g.beginPath();
    g.moveTo(32, 30);
    g.quadraticCurveTo(14, up ? 10 : 24, 2, up ? 16 : 30);
    g.quadraticCurveTo(16, 34, 32, 36);
    g.quadraticCurveTo(48, 34, 62, up ? 16 : 30);
    g.quadraticCurveTo(50, up ? 10 : 24, 32, 30);
    fillStroke(g, '#7a5634');
    blob(g, 32, 34, 5, 13);
    fillStroke(g, '#9a7149');
    g.beginPath();
    g.moveTo(28, 45); g.lineTo(32, 54); g.lineTo(36, 45);
    fillStroke(g, '#7a5634', 2.5);
    blob(g, 32, 22, 4, 4);
    fillStroke(g, '#e8dccb', 2);
  },
  [Sp.Owl]: (g, f) => {
    const up = f === 0;
    g.beginPath();
    g.moveTo(32, 30);
    g.quadraticCurveTo(16, up ? 14 : 26, 4, up ? 20 : 32);
    g.quadraticCurveTo(18, 38, 32, 38);
    g.quadraticCurveTo(46, 38, 60, up ? 20 : 32);
    g.quadraticCurveTo(48, up ? 14 : 26, 32, 30);
    fillStroke(g, '#b9a27f');
    blob(g, 32, 33, 9, 11);
    fillStroke(g, '#cbb796');
    blob(g, 32, 26, 6.5, 6);
    fillStroke(g, '#f2eadb', 2);
    g.fillStyle = INK;
    g.fillRect(29, 25, 2.5, 2.5);
    g.fillRect(34, 25, 2.5, 2.5);
  },
  [Sp.Vulture]: (g, f) => {
    const up = f === 0;
    g.beginPath();
    g.moveTo(32, 30);
    g.lineTo(0, up ? 22 : 30);
    g.lineTo(4, up ? 30 : 36);
    g.lineTo(32, 38);
    g.lineTo(60, up ? 30 : 36);
    g.lineTo(64, up ? 22 : 30);
    g.closePath();
    fillStroke(g, '#3d3330');
    blob(g, 32, 35, 6, 12);
    fillStroke(g, '#2e2624');
    blob(g, 32, 22, 3.5, 4);
    fillStroke(g, '#d9b3a0', 2);
  },
};

function generic(color: string): Draw {
  return (g, f) => {
    legs(g, [24, 38], 38, 8, f);
    blob(g, 31, 34, 15, 9);
    fillStroke(g, color);
    blob(g, 46, 30, 6, 5);
    fillStroke(g, color);
  };
}

export interface SpriteSet {
  frames: HTMLCanvasElement[][]; // [species][frame]
}

export function buildSprites(colors: string[]): SpriteSet {
  const frames: HTMLCanvasElement[][] = [];
  for (let s = 0; s < 16; s++) {
    const pair: HTMLCanvasElement[] = [];
    for (let f = 0; f < 2; f++) {
      const c = document.createElement('canvas');
      c.width = c.height = SPRITE_PX;
      const g = c.getContext('2d')!;
      g.lineJoin = 'round';
      (draws[s as Sp] ?? generic(colors[s]))(g, f);
      pair.push(c);
    }
    frames.push(pair);
  }
  return { frames };
}

/** Birds are drawn top-down (no flip, rotate to heading); the rest flip left/right. */
export const TOP_DOWN = new Set<number>([Sp.Hawk, Sp.Owl, Sp.Vulture, Sp.Heron]);
/** Swimmers drawn flat in water (fish). */
export const IN_WATER = new Set<number>([Sp.Fish]);
