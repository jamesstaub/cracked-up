/**
 * The detail panel: what the inspector shows for the node that was clicked. It reads; the only things
 * it changes are the bypass switch and the trigger button.
 */

import type { NodeTypeInfo } from '../api';
import { METER_FLOOR_DB, LevelMeter, RangeMeter, formatDb, formatNumber, measure } from './meter';
import type { BlockStats } from './meter';
import { busDetail, nodeDetail, triggerOptions } from './model';
import type { Handle, NodeDetail, SignalKind } from './model';

export interface Palette {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  border: string;
  edge: string;
  accent: string;
  ok: string;
  clip: string;
  mod: string;
}

export interface PanelHost {
  /** The meter the graph keeps for a node of the scope the selected node is in, by node id. */
  meterFor(id: string): LevelMeter | RangeMeter | null;
  /** Called when the panel's close button is pressed. */
  close(): void;
  /** Called to open a macro's inside on its own. */
  enter(): void;
  /** Called after the panel changed the node (bypass), so the graph redraws at once. */
  changed(): void;
}

/** Frames of history kept for a control signal's chart: about four seconds. */
const HISTORY = 240;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class DetailPanel {
  readonly element = el('aside', 'detail');
  private title = el('h2');
  private name = el('span', 'name');
  private desc = el('p', 'desc');
  private actions = el('div', 'actions');
  private canvas = el('canvas', 'signal');
  private readout = el('div', 'readout');
  private params = el('table');
  private paramsHead = el('h3', '', 'Parameters');
  private links = el('p', 'links');

  private handle: Handle | null = null;
  private info: NodeTypeInfo | null = null;
  private signal: SignalKind = 'audio';
  private busTo: string | null = null;
  private bypass: HTMLInputElement | null = null;
  private shown = '';
  private sinceText = 1;
  private wave = new Float32Array(0);
  private spectrum: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stats: BlockStats = { peak: 0, rms: 0, min: 0, max: 0, last: 0 };
  private level = new LevelMeter();
  private range = new RangeMeter();
  private history: number[] = [];

  constructor(private host: PanelHost) {
    this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Node details');
    const header = el('header');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close details');
    close.addEventListener('click', () => this.host.close());
    header.append(this.title, this.name, close);
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Level, waveform and spectrum of this output');
    this.element.append(
      header,
      this.desc,
      this.actions,
      this.canvas,
      this.readout,
      this.paramsHead,
      this.params,
      this.links,
    );
  }

  get open(): boolean {
    return this.handle !== null;
  }

  /** Ids of nodes whose meters the panel reads besides the selected one: its modulators. */
  modulatorIds(): string[] {
    const node = this.handle?.node;
    if (!node || node.disposed) return [];
    const ids: string[] = [];
    for (const name of Object.keys(node.params)) {
      for (const mod of node.param(name).modulators) ids.push(mod.source.id);
    }
    return ids;
  }

  show(
    handle: Handle,
    info: NodeTypeInfo | null,
    signal: SignalKind,
    busTo: string | null,
    canEnter: boolean,
  ): void {
    this.handle = handle;
    this.info = info;
    this.signal = signal;
    this.busTo = busTo;
    this.level = new LevelMeter();
    this.range = new RangeMeter();
    this.history = [];
    this.shown = '';
    this.element.hidden = false;

    this.actions.replaceChildren();
    this.bypass = null;
    const node = handle.node;
    if (node) {
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = node.bypass;
      box.addEventListener('change', () => {
        if (!node.disposed) node.bypass = box.checked;
        this.host.changed();
      });
      label.append(box, 'Bypass');
      this.bypass = box;
      this.actions.append(label);
      const detail = nodeDetail(node, info);
      if (detail.triggerable) {
        const trigger = el('button', 'trigger', 'Trigger');
        trigger.type = 'button';
        trigger.addEventListener('click', () => {
          if (!node.disposed) node.trigger(triggerOptions(node, info));
        });
        this.actions.append(trigger);
      }
      if (canEnter) {
        const enter = el('button', 'open', 'Open inside');
        enter.type = 'button';
        enter.addEventListener('click', () => this.host.enter());
        this.actions.append(enter);
      }
    }
    this.renderText();
  }

  /** A parameter changed: rewrite the text on the next frame instead of waiting for the usual interval. */
  textChanged(): void {
    this.sinceText = 1;
  }

  hide(): void {
    this.handle = null;
    this.element.hidden = true;
  }

  /** The panel's data as it stands, for tests and for hosts that want to show it their own way. */
  detail(): NodeDetail | null {
    const handle = this.handle;
    if (!handle) return null;
    if (handle.node) return handle.node.disposed ? null : nodeDetail(handle.node, this.info);
    if (handle.bus) return busDetail(handle.bus, this.busTo);
    return null;
  }

  /** Rewrites the text parts if what they say has changed. */
  private renderText(): void {
    const detail = this.detail();
    if (!detail) return;
    const mods = detail.params.map((param) =>
      param.modulators.map((mod) => {
        const meter = this.host.meterFor(mod.id);
        const swing =
          meter instanceof RangeMeter
            ? ` ${formatNumber(meter.low)} to ${formatNumber(meter.high)}`
            : '';
        return `${mod.type} #${mod.id}${swing}`;
      }),
    );
    // The switch is changed by the user as well as by this, so it is set every time, not only when
    // the rest of the text is rewritten.
    if (this.bypass && this.bypass.checked !== detail.bypassed) {
      this.bypass.checked = detail.bypassed;
    }
    const state = JSON.stringify([detail, mods]);
    if (state === this.shown) return;
    this.shown = state;

    this.title.textContent = detail.type === 'bus' ? 'bus' : detail.type;
    this.name.textContent =
      detail.kind === 'bus'
        ? detail.id
        : [`#${detail.id}`, ...detail.classes.map((name) => `.${name}`)].join(' ');
    this.desc.textContent = detail.description;

    this.paramsHead.hidden = detail.params.length === 0;
    this.params.replaceChildren(
      ...detail.params.map((param, index) => {
        const row = el('tr');
        row.title = param.description;
        const name = el('td', 'pname', param.name);
        const value = el('td', 'pvalue', param.text);
        const range =
          param.min !== null && param.max !== null
            ? `${formatNumber(param.min)} to ${formatNumber(param.max)}`
            : '';
        const meta = el(
          'td',
          'pmeta',
          [range, param.unit === 'none' ? '' : param.unit, param.rate === 'audio' ? '' : param.rate]
            .filter(Boolean)
            .join(' · '),
        );
        for (const text of mods[index] ?? []) meta.append(el('span', 'mod', `moved by ${text}`));
        row.append(name, value, meta);
        return row;
      }),
    );

    const parts: (string | HTMLElement)[] = [];
    if (detail.inputs.length > 0) {
      parts.push('From ');
      detail.inputs.forEach((text, i) => parts.push(i ? ', ' : '', el('span', '', text)));
      parts.push('. ');
    }
    if (detail.outputs.length > 0) {
      parts.push('To ');
      detail.outputs.forEach((text, i) => parts.push(i ? ', ' : '', el('span', '', text)));
      parts.push('.');
    }
    this.links.replaceChildren(...parts);
  }

  /**
   * Called once per frame while open. `analyser` is the tap on the selected output, or null when
   * nothing can be read (audio suspended, an offline engine, a node with no output).
   */
  frame(analyser: AnalyserNode | null, dt: number, colors: Palette, sampleRate: number): void {
    if (!this.handle) return;
    this.sinceText += dt;
    if (this.sinceText >= 0.15) {
      this.sinceText = 0;
      this.renderText();
    }

    let live = false;
    if (analyser) {
      if (this.wave.length !== analyser.fftSize) {
        this.wave = new Float32Array(analyser.fftSize);
        this.spectrum = new Float32Array(analyser.frequencyBinCount);
      }
      analyser.getFloatTimeDomainData(this.wave as Float32Array<ArrayBuffer>);
      measure(this.wave, this.stats);
      this.level.update(this.stats, dt);
      this.range.update(this.stats, dt);
      this.history.push(this.stats.min, this.stats.max);
      if (this.history.length > HISTORY * 2) this.history.splice(0, 2);
      if (this.signal === 'audio') analyser.getFloatFrequencyData(this.spectrum);
      live = true;
    } else {
      this.level.idle(dt);
    }
    this.draw(colors, live, sampleRate);
  }

  private draw(colors: Palette, live: boolean, sampleRate: number): void {
    const canvas = this.canvas;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';

    const pad = 8;
    const inner = width - pad * 2;
    if (this.signal === 'control') {
      this.drawControl(ctx, colors, pad, inner, height);
      const r = this.range;
      this.readout.textContent = live
        ? `value ${formatNumber(r.value)} · range ${formatNumber(r.low)} to ${formatNumber(r.high)}`
        : 'No signal to read while audio is not running.';
      return;
    }

    // Level: RMS as a solid bar, peak as a lighter one, and the held peak as a mark.
    const meterY = pad;
    const meterH = 12;
    const at = (db: number): number =>
      inner * Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
    ctx.fillStyle = colors.border;
    ctx.fillRect(pad, meterY, inner, meterH);
    ctx.fillStyle = colors.ok;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(pad, meterY, at(this.level.peakDb), meterH);
    ctx.globalAlpha = 1;
    ctx.fillRect(pad, meterY, at(this.level.rmsDb), meterH);
    if (this.level.holdDb > METER_FLOOR_DB) {
      ctx.fillStyle = this.level.clipped ? colors.clip : colors.text;
      ctx.fillRect(pad + at(this.level.holdDb) - 1, meterY, 2, meterH);
    }
    ctx.fillStyle = colors.muted;
    for (const db of [-48, -36, -24, -12, 0]) {
      const x = pad + at(db);
      ctx.fillRect(Math.min(x, pad + inner - 1), meterY + meterH, 1, 3);
      ctx.textAlign = db === 0 ? 'right' : 'center';
      ctx.fillText(String(db), x, meterY + meterH + 4);
    }

    const scopeY = meterY + meterH + 22;
    const scopeH = 56;
    const specY = scopeY + scopeH + 10;
    const specH = height - specY - pad;

    // Waveform, drawn from a rising zero crossing so a steady tone stands still.
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, scopeY + scopeH / 2 + 0.5);
    ctx.lineTo(pad + inner, scopeY + scopeH / 2 + 0.5);
    ctx.stroke();
    const wave = this.wave;
    if (live && wave.length > 0) {
      const span = wave.length >> 1;
      let start = 0;
      for (let i = 1; i < span; i++) {
        if (wave[i - 1]! <= 0 && wave[i]! > 0) {
          start = i;
          break;
        }
      }
      const gain = Math.max(1, this.stats.peak);
      ctx.strokeStyle = colors.ok;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      const steps = Math.min(span, Math.max(2, Math.floor(inner)));
      for (let i = 0; i < steps; i++) {
        const sample = wave[start + Math.floor((i / (steps - 1)) * (span - 1))] ?? 0;
        const x = pad + (i / (steps - 1)) * inner;
        const y = scopeY + scopeH / 2 - (sample / gain) * (scopeH / 2 - 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Spectrum: 30 Hz to 20 kHz on a logarithmic axis, -100 to 0 dB.
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, specY + 0.5, inner - 1, specH - 1);
    const low = Math.log(30);
    const high = Math.log(20000);
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'center';
    for (const hz of [100, 1000, 10000]) {
      const x = pad + ((Math.log(hz) - low) / (high - low)) * inner;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.round(x), specY + 1, 1, specH - 2);
      ctx.globalAlpha = 1;
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x, specY + 3);
    }
    const bins = this.spectrum;
    if (live && bins.length > 0) {
      const hzPerBin = sampleRate / 2 / bins.length;
      ctx.fillStyle = colors.ok;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(pad, specY + specH - 1);
      const columns = Math.max(2, Math.floor(inner / 2));
      for (let i = 0; i < columns; i++) {
        // Each column covers a band; take the loudest bin in it, so narrow peaks are not skipped.
        const from = Math.exp(low + (i / columns) * (high - low)) / hzPerBin;
        const to = Math.exp(low + ((i + 1) / columns) * (high - low)) / hzPerBin;
        let db = -Infinity;
        const last = Math.min(bins.length - 1, Math.max(Math.floor(from), Math.ceil(to) - 1));
        for (let bin = Math.min(bins.length - 1, Math.floor(from)); bin <= last; bin++) {
          if (bins[bin]! > db) db = bins[bin]!;
        }
        const amount = Math.min(1, Math.max(0, (db + 100) / 100));
        ctx.lineTo(pad + (i / (columns - 1)) * inner, specY + specH - 1 - amount * (specH - 2));
      }
      ctx.lineTo(pad + inner, specY + specH - 1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.readout.textContent = live
      ? `peak ${formatDb(this.level.holdDb)} dB · rms ${formatDb(this.level.rmsDb)} dB`
      : 'No signal to read while audio is not running.';
  }

  /** A control signal: its value over the last few seconds, on a scale that fits its range. */
  private drawControl(
    ctx: CanvasRenderingContext2D,
    colors: Palette,
    pad: number,
    inner: number,
    height: number,
  ): void {
    const top = pad + 12;
    const chartH = height - top - pad;
    const scale = this.range.scale > 0 ? this.range.scale : 1;
    const y = (value: number): number =>
      top + chartH / 2 - (Math.max(-1, Math.min(1, value / scale)) * (chartH - 4)) / 2;
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, top + 0.5, inner - 1, chartH - 1);
    ctx.beginPath();
    ctx.moveTo(pad, Math.round(y(0)) + 0.5);
    ctx.lineTo(pad + inner, Math.round(y(0)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`+${formatNumber(scale)}`, pad, pad - 2);
    ctx.textAlign = 'right';
    ctx.fillText('last 4 seconds', pad + inner, pad - 2);
    const history = this.history;
    const count = history.length / 2;
    if (count < 1) return;
    ctx.strokeStyle = colors.mod;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = pad + inner - ((count - 1 - i) / (HISTORY - 1)) * inner;
      const a = y(history[i * 2]!);
      const b = y(history[i * 2 + 1]!);
      if (i === 0) ctx.moveTo(x, a);
      else ctx.lineTo(x, a);
      if (Math.abs(a - b) > 0.5) ctx.lineTo(x, b);
    }
    ctx.stroke();
  }
}
