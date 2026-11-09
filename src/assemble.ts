import { Timeline, set, type TweenVars } from './timeline';
import { collectTasks, type StyledElement, type Task, type TaskKind } from './scan';
import { splitText, type TextSplit, type TypingMode } from './text';
import { createAgent, createDrawBox, createLayer, injectStyles, resolveAgents, type AgentConfig } from './overlay';

export interface AssembleOptions {
  /** How many agents, or a list of names and colors. Default 5 (max 24). */
  agents?: number | readonly AgentConfig[];
  /** Fit the whole build into this many seconds. Omit or 0 for the natural length. */
  duration?: number;
  /** Playback speed when `duration` is not set. Default 1. */
  speed?: number;
  /** `immediate` plays right away; `viewport` waits until the target scrolls into view. */
  trigger?: 'immediate' | 'viewport';
  /** Start automatically. Default true. */
  autoplay?: boolean;
  /** How text is typed. `auto` types short text by letter and long text by word. */
  typing?: TypingMode;
  /** Upper bound on animated pieces; the smallest nested ones are merged into their parent. Default 250. */
  maxTasks?: number;
  /** Remove the overlay and restore inline styles when done. Default true. */
  cleanup?: boolean;
  /** z-index of the overlay layer. */
  zIndex?: number;
  /** Show agent name tags. Default true. */
  labels?: boolean;
  /** Show what each agent is doing next to its name. Default true. */
  actions?: boolean;
  /** `respect` skips the animation when the user prefers reduced motion. Default `respect`. */
  reducedMotion?: 'respect' | 'ignore';
  onStart?: () => void;
  /** Called every frame with progress from 0 to 1. */
  onProgress?: (progress: number) => void;
  onComplete?: () => void;
}

export interface Crew {
  /** The underlying timeline (play, pause, progress, timeScale…). */
  readonly timeline: Timeline;
  /** Resolves when the build finishes or the crew is destroyed. */
  readonly finished: Promise<void>;
  play(): void;
  pause(): void;
  /** Jump to the end, revealing everything. */
  finish(): void;
  /** Reset the target and build it again. */
  replay(): void;
  /** Stop and restore the target as it was. */
  destroy(): void;
}

type Resolved = Required<Omit<AssembleOptions, 'onStart' | 'onProgress' | 'onComplete' | 'duration'>> &
  Pick<AssembleOptions, 'onStart' | 'onProgress' | 'onComplete' | 'duration'>;

interface Point {
  x: number;
  y: number;
}
interface LinePoint extends Point {
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Timing model, in seconds. */
const TIMING = {
  travel: (px: number) => clamp(0.22 + px / 1700, 0.28, 0.85),
  draw: (area: number) => clamp(0.32 + Math.sqrt(area) / 1500, 0.38, 0.95),
  frame: (area: number) => clamp(0.18 + Math.sqrt(area) / 2600, 0.2, 0.45),
  fade: 0.3,
  sweep: 0.6,
  perChar: 0.028,
  perWord: 0.075,
  typeMax: 1.7,
  gap: 0.06,
};

const RESTORED_PROPS = ['visibility', 'opacity', 'clip-path', '-webkit-clip-path'];
const MOVE_EASE = 'power2.inOut';
const LATE = { immediateRender: false } as const;

interface Build {
  tl: Timeline;
  finished: Promise<void>;
  teardown(): void;
}

function build(root: StyledElement, o: Resolved): Build {
  injectStyles();

  // Remember inline styles we are about to touch so teardown restores them exactly.
  const saved = new Map<StyledElement, { hadStyle: boolean; props: Record<string, [string, string]> }>();
  const remember = (el: StyledElement) => {
    if (saved.has(el)) return;
    const props: Record<string, [string, string]> = {};
    for (const p of RESTORED_PROPS) props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    saved.set(el, { hadStyle: el.hasAttribute('style'), props });
  };

  const layer = createLayer(o.zIndex, o.labels, o.actions);
  const origin = layer.getBoundingClientRect();
  const tasks = collectTasks(root, origin, o.maxTasks);
  const finalOpacity = tasks.map((t) => parseFloat(getComputedStyle(t.el).opacity) || 1);

  remember(root);
  root.style.visibility = 'hidden';
  root.removeAttribute('data-assemble-pending');
  const splits: (TextSplit | null)[] = tasks.map((t) => {
    remember(t.el);
    t.el.style.visibility = 'hidden';
    return t.kind === 'text' ? splitText(t.el, o.typing) : null;
  });

  const agents = resolveAgents(o.agents).map((cfg) => createAgent(layer, cfg));

  // Agents spawn near the top of the target's visible part.
  const r = root.getBoundingClientRect();
  const top = clamp(r.top, 0, innerHeight);
  const bottom = clamp(r.bottom, 0, innerHeight);
  const left = clamp(r.left, 0, innerWidth);
  const right = clamp(r.right, 0, innerWidth);
  const spawn = { x: (left + right) / 2 - origin.left, y: top + Math.min(120, (bottom - top) * 0.25) - origin.top };

  let resolveFinished!: () => void;
  const finished = new Promise<void>((res) => (resolveFinished = res));
  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    tl.kill();
    for (const s of splits) s?.restore();
    saved.forEach((entry, el) => {
      for (const p of RESTORED_PROPS) {
        const [value, priority] = entry.props[p];
        if (value) el.style.setProperty(p, value, priority);
        else el.style.removeProperty(p);
      }
      if (!entry.hadStyle && !el.getAttribute('style')) el.removeAttribute('style');
    });
    layer.remove();
    resolveFinished();
  };

  const tl: Timeline = new Timeline({
    paused: true,
    onStart: () => o.onStart?.(),
    onUpdate: () => o.onProgress?.(tl.progress()),
    onComplete: () => {
      if (o.cleanup) teardown();
      else resolveFinished();
      o.onComplete?.();
    },
  });

  // Per-agent scheduling state.
  const state = agents.map((a, n) => {
    const offset = (n - (agents.length - 1) / 2) * 34;
    const pos = { x: spawn.x + offset, y: spawn.y + (n % 2) * 18 };
    tl.fromTo(a.el, { x: pos.x, y: pos.y, scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.42, ease: 'back.out(2)' }, n * 0.07);
    return { pos, free: 0.45 + n * 0.07, last: 0 };
  });

  const say = (i: number, text: string, at: number) => tl.set(agents[i].tag, { attr: { 'data-action': text } }, at);
  const cursor = (i: number, mode: 'arrow' | 'cross' | 'beam', at: number) => tl.set(agents[i].el, { attr: { 'data-mode': mode } }, at);

  const move = (i: number, to: Point, at: number, dur: number) => {
    const from = state[i].pos;
    tl.fromTo(agents[i].el, { x: from.x, y: from.y }, { x: to.x, y: to.y, duration: dur, ease: MOVE_EASE, ...LATE }, at);
    state[i].pos = { ...to };
  };

  /** Drag out a box from the task's top-left to bottom-right, with the cursor following. */
  const drag = (i: number, task: Task, kind: TaskKind, at: number, dur: number, showSize: boolean) => {
    const { box, size } = createDrawBox(layer, kind, agents[i].config.color, showSize);
    const { x, y, w, h } = task.rect;
    set(box, { x, y });
    tl.set(box, { autoAlpha: 1 }, at);
    const vars: TweenVars = { width: w, height: h, duration: dur, ease: MOVE_EASE, ...LATE };
    if (size) {
      vars.onUpdate = () => {
        // Read back the value we just wrote (not offsetWidth) to avoid a forced layout per frame.
        size.textContent = `${Math.round(parseFloat(box.style.width) || 0)} × ${Math.round(parseFloat(box.style.height) || 0)}`;
      };
    }
    tl.fromTo(box, { width: 0, height: 0 }, vars, at);
    move(i, { x: x + w, y: y + h }, at, dur);
    return box;
  };

  const fadeIn = (task: Task, at: number) => {
    tl.set(task.el, { visibility: 'visible' }, at);
    tl.fromTo(task.el, { opacity: 0 }, { opacity: finalOpacity[task.id], duration: TIMING.fade, ease: 'power1.out', ...LATE }, at);
  };

  /** Schedules one task for agent `i` starting at `at`; returns when the agent is free. */
  const perform = (i: number, task: Task, at: number): number => {
    let t = at;

    if (task.kind === 'media' || task.kind === 'block') {
      say(i, `placing ${task.label}`, t);
      cursor(i, 'cross', t);
      const dur = TIMING.draw(task.area);
      const box = drag(i, task, task.kind, t, dur, true);
      t += dur;
      tl.set(task.el, { visibility: 'visible' }, t);
      tl.fromTo(task.el, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: TIMING.sweep, ease: 'power2.out', ...LATE }, t);
      tl.to(box, { autoAlpha: 0, duration: TIMING.sweep, ...LATE }, t);
      cursor(i, 'arrow', t);
      return t + TIMING.sweep * 0.6;
    }

    let frame: HTMLElement | null = null;
    if (task.hasBox) {
      say(i, `drawing ${task.kind === 'text' ? task.el.tagName.toLowerCase() : task.label}`, t);
      cursor(i, 'cross', t);
      const dur = TIMING.draw(task.area);
      frame = drag(i, task, 'box', t, dur, true);
      t += dur;
      fadeIn(task, t);
      tl.to(frame, { autoAlpha: 0, duration: TIMING.fade, ...LATE }, t);
      cursor(i, 'arrow', t);
      if (task.kind === 'box') return t + TIMING.fade * 0.5;
      t += TIMING.fade * 0.6;
    }

    const chunks = splits[task.id]!.chunks;
    if (!frame) {
      say(i, 'text box', t);
      cursor(i, 'cross', t);
      const dur = TIMING.frame(task.area);
      frame = drag(i, task, 'text', t, dur, false);
      t += dur;
      tl.set(task.el, { visibility: 'visible' }, t);
    }
    if (!chunks.length) return t;

    // Measure where the caret sits after each chunk (chunks are hidden, but laid out).
    const ends: LinePoint[] = chunks.map((c) => {
      const b = c.getBoundingClientRect();
      return { x: b.right - origin.left, y: b.top - origin.top, h: b.height };
    });
    const f = chunks[0].getBoundingClientRect();
    const start: LinePoint = { x: f.left - origin.left, y: f.top - origin.top, h: f.height };
    const handle = (p: LinePoint): Point => ({ x: p.x + 9, y: p.y + p.h * 0.55 });

    const wordy = chunks.some((c) => /\S\s*\S/.test(c.textContent || ''));
    const typeDur = clamp(chunks.length * (wordy ? TIMING.perWord : TIMING.perChar), 0.2, TIMING.typeMax);
    const reach = 0.22;

    move(i, handle(start), t, reach);
    cursor(i, 'beam', t + reach * 0.5);
    t += reach;
    say(i, `typing ${task.label}`, t);

    const caret = agents[i].caret;
    tl.set(caret, { x: start.x, y: start.y, height: start.h, autoAlpha: 1 }, t);

    const counter = { n: 0 };
    let shown = 0;
    const total = chunks.length;
    tl.fromTo(
      counter,
      { n: 0 },
      {
        n: total,
        duration: typeDur,
        ease: 'none',
        ...LATE,
        onUpdate: () => {
          const k = Math.min(total, Math.round(counter.n));
          if (k > shown) for (let j = shown; j < k; j++) chunks[j].style.visibility = '';
          else for (let j = k; j < shown; j++) chunks[j].style.visibility = 'hidden';
          shown = k;
          const p = k === 0 ? start : ends[k - 1];
          set(caret, { x: p.x, y: p.y, height: p.h });
          set(agents[i].el, handle(p));
        },
      },
      t,
    );
    t += typeDur;
    state[i].pos = handle(ends[total - 1]);
    tl.set(caret, { autoAlpha: 0 }, t + 0.12);
    tl.to(frame, { autoAlpha: 0, duration: 0.25, ...LATE }, t);
    cursor(i, 'arrow', t + 0.12);
    return t + 0.08;
  };

  // Greedy scheduler: the earliest-free agent takes the reachable task it can start soonest,
  // looking at the next 10 tasks in reading order. Children wait for their parent.
  const queue = tasks
    .slice()
    .sort((a, b) => Math.round(a.rect.y / 24) - Math.round(b.rect.y / 24) || a.rect.x - b.rect.x || a.id - b.id);
  const doneAt = new Array<number>(tasks.length).fill(-1);

  while (queue.length) {
    let i = 0;
    for (let k = 1; k < state.length; k++) if (state[k].free < state[i].free) i = k;
    const st = state[i];

    let best = -1;
    let bestScore = Infinity;
    let bestStart = 0;
    let bestTravel = 0;
    let considered = 0;
    for (let j = 0; j < queue.length && considered < 10; j++) {
      const task = queue[j];
      if (task.parent !== -1 && doneAt[task.parent] < 0) continue;
      const travel = TIMING.travel(distance(st.pos, task.rect));
      const start = Math.max(st.free + travel, task.parent === -1 ? 0 : doneAt[task.parent] + 0.05);
      const score = start + considered * 0.04;
      if (score < bestScore) {
        bestScore = score;
        best = j;
        bestStart = start;
        bestTravel = travel;
      }
      considered++;
    }
    if (best < 0) {
      best = 0;
      bestTravel = TIMING.travel(distance(st.pos, queue[0].rect));
      bestStart = st.free + bestTravel;
    }

    const task = queue.splice(best, 1)[0];
    say(i, `→ ${task.label}`, bestStart - bestTravel);
    move(i, { x: task.rect.x, y: task.rect.y }, bestStart - bestTravel, bestTravel);
    doneAt[task.id] = perform(i, task, bestStart);
    st.free = doneAt[task.id] + TIMING.gap;
    st.last = doneAt[task.id];
  }

  // Wrap up: each agent reports done, then the crew floats away.
  const end = Math.max(0.5, ...doneAt);
  agents.forEach((a, n) => {
    say(n, 'done ✓', state[n].last + 0.05);
    cursor(n, 'arrow', state[n].last + 0.05);
    tl.to(a.el, { autoAlpha: 0, scale: 0.6, y: '-=14', duration: 0.35, ease: 'power2.in', ...LATE }, end + 0.35 + n * 0.05);
  });

  if (o.duration && o.duration > 0) tl.timeScale(tl.duration() / o.duration);
  else tl.timeScale(o.speed || 1);

  return { tl, finished, teardown };
}

const noop = () => {};

/**
 * Blank `target`, then let a crew of cursors rebuild it: drawing boxes, typing text and
 * placing media until the real content is back.
 */
export function assemble(target: string | Element, options: AssembleOptions = {}): Crew {
  const root = (typeof target === 'string' ? document.querySelector(target) : target) as StyledElement | null;
  if (!root) throw new Error(`cursorcrew: target not found (${String(target)})`);

  const o: Resolved = {
    agents: 5,
    speed: 1,
    typing: 'auto',
    maxTasks: 250,
    cleanup: true,
    zIndex: 2147483000,
    labels: true,
    actions: true,
    autoplay: true,
    trigger: 'immediate',
    reducedMotion: 'respect',
    ...options,
  };

  if (o.reducedMotion === 'respect' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.removeAttribute('data-assemble-pending');
    if (o.onComplete) queueMicrotask(o.onComplete);
    return {
      timeline: new Timeline({ paused: true }),
      finished: Promise.resolve(),
      play: noop,
      pause: noop,
      finish: noop,
      replay: noop,
      destroy: noop,
    };
  }

  let current = build(root, o);
  let observer: IntersectionObserver | null = null;
  const stopWatching = () => {
    observer?.disconnect();
    observer = null;
  };

  if (o.autoplay) {
    if (o.trigger === 'viewport' && root !== document.body && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            stopWatching();
            current.tl.play();
          }
        },
        { threshold: 0.15 },
      );
      observer.observe(root);
    } else {
      current.tl.play();
    }
  }

  return {
    get timeline() {
      return current.tl;
    },
    get finished() {
      return current.finished;
    },
    play: () => void current.tl.play(),
    pause: () => void current.tl.pause(),
    finish() {
      stopWatching();
      current.tl.progress(1);
    },
    replay() {
      stopWatching();
      current.teardown();
      current = build(root, o);
      current.tl.play();
    },
    destroy() {
      stopWatching();
      current.teardown();
    },
  };
}
