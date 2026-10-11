// Clip export: composes a branded 1080×1920 (portrait) or 1920×1080 (landscape) frame from
// the live map each animation frame and records it with MediaRecorder. Free, no account.

import { SPECIES } from '../sim/species';
import { SPECIES_COLORS } from '../render/palette';

export interface ClipInfo {
  when: string;
  caption: string;
  counts: number[];
  seedLine: string;
}

export class ClipRecorder {
  private canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private endAt = 0;
  private cardFrom = 0;
  private started = 0;
  portrait = true;
  onDone: (blob: Blob, ext: string) => void = () => {};
  onTick: (left: number) => void = () => {};

  get recording(): boolean {
    return this.rec !== null;
  }

  start(seconds: number, portrait: boolean): void {
    this.portrait = portrait;
    this.canvas.width = portrait ? 1080 : 1920;
    this.canvas.height = portrait ? 1920 : 1080;
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const stream = this.canvas.captureStream(30);
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    this.rec.onstop = () => {
      this.onDone(new Blob(this.chunks, { type: mime || 'video/webm' }), ext);
      this.rec = null;
    };
    this.started = performance.now();
    this.cardFrom = this.started + seconds * 1000;
    this.endAt = this.cardFrom + 2200;
    this.rec.start(250);
  }

  cancel(): void {
    if (this.rec) {
      this.rec.onstop = null;
      this.rec.stop();
      this.rec = null;
    }
  }

  /** Call once per animation frame while recording. */
  frame(map: HTMLCanvasElement, info: ClipInfo): void {
    if (!this.rec) return;
    const now = performance.now();
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.onTick(Math.max(0, Math.ceil((this.cardFrom - now) / 1000)));
    if (now >= this.endAt) {
      this.rec.stop();
      return;
    }
    if (now >= this.cardFrom) {
      this.endCard(info, Math.min(1, (now - this.cardFrom) / 400));
      return;
    }
    g.fillStyle = '#101412';
    g.fillRect(0, 0, W, H);
    // crop the live map to the clip's aspect, centred on the view
    const mw = map.width;
    const mh = map.height;
    const top = this.portrait ? 170 : 0;
    const bottom = this.portrait ? 300 : 0;
    const areaH = H - top - bottom;
    const aspect = W / areaH;
    let sw = mw;
    let sh = mw / aspect;
    if (sh > mh) {
      sh = mh;
      sw = mh * aspect;
    }
    g.drawImage(map, (mw - sw) / 2, (mh - sh) / 2, sw, sh, 0, top, W, areaH);

    // header
    const pad = this.portrait ? 56 : 48;
    if (this.portrait) {
      g.fillStyle = '#101412';
      g.fillRect(0, 0, W, top);
      g.fillRect(0, H - bottom, W, bottom);
    } else {
      const grad = g.createLinearGradient(0, 0, 0, 160);
      grad.addColorStop(0, 'rgba(10,14,12,0.75)');
      grad.addColorStop(1, 'rgba(10,14,12,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, 160);
    }
    g.fillStyle = '#f3efe6';
    g.font = `650 ${this.portrait ? 64 : 52}px Fraunces, Georgia, serif`;
    g.textBaseline = 'alphabetic';
    g.fillText('Thicket', pad, this.portrait ? 110 : 80);
    g.font = `500 ${this.portrait ? 36 : 30}px Inter, system-ui, sans-serif`;
    g.fillStyle = '#c8d0c4';
    g.textAlign = 'right';
    g.fillText(info.when, W - pad, this.portrait ? 108 : 78);
    g.textAlign = 'left';

    // caption
    if (info.caption) {
      g.font = `600 ${this.portrait ? 40 : 34}px Inter, system-ui, sans-serif`;
      const text = info.caption;
      const tw = Math.min(W - pad * 2, g.measureText(text).width + 56);
      const cy = this.portrait ? top + 40 : 120;
      g.fillStyle = 'rgba(16,20,18,0.82)';
      g.beginPath();
      g.roundRect((W - tw) / 2, cy, tw, 72, 36);
      g.fill();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.fillText(text, W / 2, cy + 49, W - pad * 2 - 40);
      g.textAlign = 'left';
    }

    // population strip
    const live = SPECIES.filter((s) => info.counts[s.id] > 0);
    const stripY = this.portrait ? H - bottom + 50 : H - 96;
    if (!this.portrait) {
      g.fillStyle = 'rgba(10,14,12,0.7)';
      g.fillRect(0, H - 130, W, 130);
    }
    const colW = (W - pad * 2) / Math.max(1, Math.min(live.length, this.portrait ? 4 : 8));
    live.forEach((s, k) => {
      const per = this.portrait ? 4 : 8;
      const col = k % per;
      const row = Math.floor(k / per);
      const x = pad + col * colW;
      const y = stripY + row * 100;
      g.fillStyle = SPECIES_COLORS[s.id];
      g.fillRect(x, y + 8, 18, 18);
      g.fillStyle = '#c8d0c4';
      g.font = `500 ${this.portrait ? 30 : 26}px Inter, system-ui, sans-serif`;
      g.fillText(s.plural, x + 30, y + 26);
      g.fillStyle = '#ffffff';
      g.font = `650 ${this.portrait ? 44 : 38}px Inter, system-ui, sans-serif`;
      g.fillText(info.counts[s.id].toLocaleString(), x, y + 74);
    });
  }

  private endCard(info: ClipInfo, a: number): void {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = `rgba(16,20,18,${0.25 + 0.75 * a})`;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = a;
    g.textAlign = 'center';
    g.fillStyle = '#6cbf86';
    g.beginPath();
    g.arc(W / 2, H / 2 - 230, 54, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#101412';
    g.beginPath();
    g.moveTo(W / 2, H / 2 - 262);
    g.lineTo(W / 2 + 26, H / 2 - 214);
    g.lineTo(W / 2 - 26, H / 2 - 214);
    g.closePath();
    g.fill();
    g.fillStyle = '#f3efe6';
    g.font = '650 96px Fraunces, Georgia, serif';
    g.fillText('Thicket', W / 2, H / 2 - 70);
    g.font = '500 38px Inter, system-ui, sans-serif';
    g.fillStyle = '#c8d0c4';
    if (info.caption) g.fillText(info.caption, W / 2, H / 2 + 10, W - 120);
    g.fillText(info.when, W / 2, H / 2 + 70, W - 120);
    g.font = '500 30px Inter, system-ui, sans-serif';
    g.fillStyle = '#9aa29a';
    g.fillText(info.seedLine, W / 2, H / 2 + 150, W - 120);
    g.fillText('Same seed, same story. Replay it yourself.', W / 2, H / 2 + 196, W - 120);
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }
}
