import { describe, expect, it, vi } from 'vitest';
import { Timeline, set } from '../src/timeline';

const el = () => document.createElement('div');

describe('Timeline', () => {
  it('renders fromTo start values immediately unless immediateRender is false', () => {
    const a = el();
    const b = el();
    const tl = new Timeline({ paused: true });
    tl.fromTo(a, { x: 10, y: 20, scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1 }, 0);
    tl.fromTo(b, { opacity: 0 }, { opacity: 1, immediateRender: false }, 0);
    expect(a.style.transform).toBe('translate3d(10px,20px,0) scale(0)');
    expect(a.style.visibility).toBe('hidden');
    expect(b.style.opacity).toBe('');
  });

  it('interpolates numbers, px sizes and numeric strings with easing', () => {
    const box = el();
    const counter = { n: 0 };
    const tl = new Timeline({ paused: true });
    tl.fromTo(box, { width: 0 }, { width: 200, duration: 1, ease: 'none', immediateRender: false }, 0);
    tl.fromTo(box, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: 'none', immediateRender: false }, 0);
    tl.fromTo(counter, { n: 0 }, { n: 10, duration: 1, ease: 'power2.inOut', immediateRender: false }, 0);
    tl.progress(0.5);
    expect(box.style.width).toBe('100px');
    expect(box.style.clipPath).toBe('inset(0% 0% 50% 0%)');
    expect(counter.n).toBeCloseTo(5);
    tl.progress(0.25);
    expect(box.style.width).toBe('50px');
  });

  it('reads current values lazily for to() and supports relative values', () => {
    const a = el();
    set(a, { x: 5, y: 20 });
    const tl = new Timeline({ paused: true });
    tl.to(a, { y: '-=14', scale: 0.6, duration: 0.5 }, 1);
    tl.progress(1);
    expect(a.style.transform).toBe('translate3d(5px,6px,0) scale(0.6)');
  });

  it('applies set() at its position, including attributes', () => {
    const a = el();
    const tl = new Timeline({ paused: true });
    tl.set(a, { attr: { 'data-mode': 'cross' } }, 1);
    tl.to({}, { duration: 2 }, 0);
    tl.progress(0.4);
    expect(a.getAttribute('data-mode')).toBeNull();
    tl.progress(0.6);
    expect(a.getAttribute('data-mode')).toBe('cross');
  });

  it('fires callbacks and reports duration/progress', () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    const tl = new Timeline({ paused: true, onStart, onUpdate, onComplete });
    tl.to({ v: 0 }, { v: 1, duration: 0.5 }, 1);
    expect(tl.duration()).toBe(1.5);
    tl.progress(1);
    tl.progress(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalled();
    expect(tl.progress()).toBe(1);
  });

  it('plays in real time and honours timeScale', async () => {
    const target = { v: 0 };
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const tl = new Timeline({ paused: true, onComplete: resolve });
      tl.to(target, { v: 1, duration: 0.3, ease: 'none' }, 0);
      tl.timeScale(3).play();
    });
    expect(target.v).toBe(1);
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('kill() stops playback without completing', async () => {
    const onComplete = vi.fn();
    const tl = new Timeline({ onComplete });
    tl.to({ v: 0 }, { v: 1, duration: 0.05 }, 0);
    tl.kill();
    await new Promise((r) => setTimeout(r, 120));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
