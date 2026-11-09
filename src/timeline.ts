/**
 * A tiny requestAnimationFrame timeline engine.
 *
 * It covers exactly what cursorcrew needs (absolute-position set / to / fromTo,
 * play, pause, kill, progress, timeScale) so the library ships with zero
 * dependencies. Transforms are written as translate3d so moving cursors and
 * boxes stay on the compositor.
 */

export type Ease = (t: number) => number;
export type EaseName =
  | 'none'
  | 'power1.in'
  | 'power1.out'
  | 'power1.inOut'
  | 'power2.in'
  | 'power2.out'
  | 'power2.inOut'
  | 'back.out'
  | `back.out(${number})`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TweenTarget = Element | Record<string, any>;

export interface TweenVars {
  duration?: number;
  ease?: EaseName | Ease;
  immediateRender?: boolean;
  onUpdate?: () => void;
  attr?: Record<string, string>;
  [prop: string]: unknown;
}

export interface TimelineOptions {
  paused?: boolean;
  onStart?: () => void;
  onUpdate?: () => void;
  onComplete?: () => void;
}

const EASES: Record<string, Ease> = {
  none: (t) => t,
  'power1.in': (t) => t * t,
  'power1.out': (t) => 1 - (1 - t) * (1 - t),
  'power1.inOut': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'power2.in': (t) => t * t * t,
  'power2.out': (t) => 1 - Math.pow(1 - t, 3),
  'power2.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function getEase(name: EaseName | Ease | undefined): Ease {
  if (typeof name === 'function') return name;
  if (!name) return EASES['power1.out'];
  if (EASES[name]) return EASES[name];
  const m = /^back\.out(?:\(([\d.]+)\))?$/.exec(name);
  if (m) {
    const c1 = m[1] ? +m[1] : 1.70158;
    const c3 = c1 + 1;
    return (EASES[name] = (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2));
  }
  return EASES['power1.out'];
}

const RESERVED = new Set(['duration', 'ease', 'immediateRender', 'onUpdate', 'onComplete', 'onStart', 'overwrite']);
const TRANSFORM = new Set(['x', 'y', 'scale']);

interface TransformState {
  x: number;
  y: number;
  scale: number;
}
const transforms = new WeakMap<Element, TransformState>();
function transformOf(el: Element): TransformState {
  let t = transforms.get(el);
  if (!t) transforms.set(el, (t = { x: 0, y: 0, scale: 1 }));
  return t;
}

const isElement = (o: unknown): o is Element & ElementCSSInlineStyle =>
  !!o && (o as Node).nodeType === 1;

function read(target: TweenTarget, prop: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!isElement(target)) return (target as Record<string, any>)[prop];
  if (TRANSFORM.has(prop)) return transformOf(target)[prop as keyof TransformState];
  const cs = getComputedStyle(target);
  if (prop === 'autoAlpha') return cs.visibility === 'hidden' ? 0 : parseFloat(cs.opacity);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = String((target.style as any)[prop] || (cs as any)[prop] || '');
  return /^-?[\d.]+(px)?$/.test(v) ? parseFloat(v) : v;
}

/** Apply values to a target immediately (no animation). */
export function set(target: TweenTarget, values: object): void {
  const props = values as Record<string, unknown>;
  if (!isElement(target)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const k in props) if (!RESERVED.has(k)) (target as Record<string, any>)[k] = props[k];
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = target.style as any;
  let t: TransformState | null = null;
  for (const p in props) {
    if (RESERVED.has(p)) continue;
    const v = props[p];
    if (p === 'attr') {
      for (const [k, val] of Object.entries(v as Record<string, string>)) target.setAttribute(k, val);
    } else if (TRANSFORM.has(p)) {
      (t ??= transformOf(target))[p as keyof TransformState] = v as number;
    } else if (p === 'autoAlpha') {
      s.opacity = String(v);
      s.visibility = (v as number) <= 0 ? 'hidden' : 'inherit';
    } else if (p === 'width' || p === 'height') {
      s[p] = typeof v === 'number' ? `${v}px` : v;
    } else {
      s[p] = typeof v === 'number' ? String(v) : v;
    }
  }
  if (t) s.transform = `translate3d(${t.x}px,${t.y}px,0)${t.scale !== 1 ? ` scale(${t.scale})` : ''}`;
}

const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

function interpolator(from: unknown, to: unknown): (e: number) => unknown {
  if (typeof to === 'string' && /^[-+]=/.test(to)) {
    to = (Number(from) || 0) + (to[0] === '-' ? -1 : 1) * parseFloat(to.slice(2));
  }
  if (typeof to === 'number') {
    const a = Number(from) || 0;
    const b = to;
    return (e) => a + (b - a) * e;
  }
  if (typeof to === 'string' && typeof from === 'string') {
    const bn = to.match(NUMBER) ?? [];
    const an = from.match(NUMBER) ?? [];
    if (bn.length && an.length === bn.length) {
      const parts = to.split(NUMBER);
      return (e) => {
        let out = parts[0];
        for (let i = 0; i < bn.length; i++) out += +an[i] + (+bn[i] - +an[i]) * e + parts[i + 1];
        return out;
      };
    }
  }
  // Non-numeric values (visibility, attributes…) snap at the start.
  return () => to;
}

interface Tween {
  target: TweenTarget;
  from: Record<string, unknown> | null;
  to: TweenVars;
  start: number;
  dur: number;
  ease: Ease;
  fns: Record<string, (e: number) => unknown> | null;
  done: boolean;
}

export class Timeline {
  private kids: Tween[] = [];
  private t = 0;
  private end = 0;
  private ts = 1;
  private paused = true;
  private dead = false;
  private started = false;
  private completed = false;
  private raf = 0;
  private last = 0;

  constructor(private readonly opts: TimelineOptions = {}) {
    this.tick = this.tick.bind(this);
    if (!opts.paused) this.play();
  }

  /** Apply `vars` instantly at `position` seconds. */
  set(target: TweenTarget, vars: TweenVars, position?: number): this {
    return this.add(target, null, { ...vars, duration: 0 }, position);
  }

  /** Tween from the target's current values (read when the tween starts). */
  to(target: TweenTarget, vars: TweenVars, position?: number): this {
    return this.add(target, null, vars, position);
  }

  /** Tween between explicit values. Renders `from` right away unless `immediateRender: false`. */
  fromTo(target: TweenTarget, from: Record<string, unknown>, to: TweenVars, position?: number): this {
    if (to.immediateRender !== false) set(target, from);
    return this.add(target, from, to, position);
  }

  play(): this {
    if (this.dead || this.completed) return this;
    this.paused = false;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    return this;
  }

  pause(): this {
    this.paused = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    return this;
  }

  kill(): this {
    this.pause();
    this.dead = true;
    this.kids = [];
    return this;
  }

  /** Total length in seconds, before timeScale. */
  duration(): number {
    return this.end;
  }

  /** Current playhead in seconds. */
  time(): number {
    return this.t;
  }

  isActive(): boolean {
    return !this.paused && !this.dead && !this.completed;
  }

  timeScale(): number;
  timeScale(value: number): this;
  timeScale(value?: number): number | this {
    if (value === undefined) return this.ts;
    this.ts = value > 0 && Number.isFinite(value) ? value : 1;
    return this;
  }

  progress(): number;
  progress(value: number): this;
  progress(value?: number): number | this {
    if (value === undefined) return this.end ? this.t / this.end : 1;
    this.goto(value * this.end);
    return this;
  }

  private add(target: TweenTarget, from: Record<string, unknown> | null, to: TweenVars, position?: number): this {
    const tween: Tween = {
      target,
      from,
      to,
      start: position ?? this.end,
      dur: Math.max(0, to.duration ?? 0.5),
      ease: getEase(to.ease),
      fns: null,
      done: false,
    };
    // Keep children sorted by start time (stable), so later tweens win on overlap.
    let i = this.kids.length;
    while (i > 0 && this.kids[i - 1].start > tween.start) i--;
    this.kids.splice(i, 0, tween);
    this.end = Math.max(this.end, tween.start + tween.dur);
    return this;
  }

  private render(time: number): void {
    for (const c of this.kids) {
      if (c.start > time) break;
      if (c.done) continue;
      if (!c.fns) {
        c.fns = {};
        for (const k in c.to) {
          if (RESERVED.has(k)) continue;
          if (k === 'attr') {
            const attr = c.to.attr;
            c.fns.attr = () => attr;
          } else {
            c.fns[k] = interpolator(c.from && k in c.from ? c.from[k] : read(c.target, k), c.to[k]);
          }
        }
      }
      const p = c.dur ? Math.min(1, (time - c.start) / c.dur) : 1;
      const e = c.ease(p);
      const props: Record<string, unknown> = {};
      for (const f in c.fns) props[f] = c.fns[f](e);
      set(c.target, props);
      c.to.onUpdate?.();
      if (p >= 1) c.done = true;
    }
  }

  private goto(time: number): void {
    if (this.dead) return;
    time = Math.max(0, Math.min(time, this.end));
    if (!this.started) {
      this.started = true;
      this.opts.onStart?.();
    }
    this.t = time;
    this.render(time);
    this.opts.onUpdate?.();
    if (time >= this.end && !this.completed) {
      this.completed = true;
      this.pause();
      this.opts.onComplete?.();
    }
  }

  private tick(now: number): void {
    this.raf = 0;
    if (this.paused || this.dead) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    // Lag smoothing: a stalled or backgrounded tab resumes instead of jumping ahead.
    if (dt > 0.25) dt = 1 / 60;
    this.goto(this.t + dt * this.ts);
    if (!this.paused && !this.dead) this.raf = requestAnimationFrame(this.tick);
  }
}
