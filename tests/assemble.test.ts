import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assemble } from '../src/index';
import { fakeLayout } from './setup-layout';

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = fakeLayout();
  document.body.innerHTML = `
    <main id="app" data-assemble-pending>
      <h1>Hello crew</h1>
      <div class="card" style="border: 1px solid red">
        <p>Some text</p>
      </div>
      <img alt="" src="data:,">
      <aside data-assemble="skip"><p>Left alone</p></aside>
    </main>`;
});

afterEach(() => {
  restoreLayout();
  vi.unstubAllGlobals();
});

const $ = (s: string) => document.querySelector(s) as HTMLElement;

describe('assemble', () => {
  it('blanks the target and builds an overlay with agents', () => {
    const crew = assemble('#app', { agents: 3, autoplay: false });
    expect($('.cc-layer')).toBeTruthy();
    expect(document.querySelectorAll('.cc-agent')).toHaveLength(3);
    expect($('#app').style.visibility).toBe('hidden');
    expect($('#app').hasAttribute('data-assemble-pending')).toBe(false);
    expect($('h1').style.visibility).toBe('hidden');
    expect($('h1').querySelectorAll('[data-cc-chunk]')).toHaveLength('Hellocrew'.length);
    expect($('.card').style.visibility).toBe('hidden');
    expect($('img').style.visibility).toBe('hidden');
    // skipped subtree is untouched
    expect($('aside p').style.visibility).toBe('');
    expect(crew.timeline.duration()).toBeGreaterThan(1);
    crew.destroy();
  });

  it('finish() reveals everything and restores the original DOM', async () => {
    const onComplete = vi.fn();
    const crew = assemble('#app', { onComplete });
    crew.finish();
    await crew.finished;
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect($('.cc-layer')).toBeNull();
    expect($('#app').getAttribute('style')).toBeNull();
    expect($('h1').innerHTML).toBe('Hello crew');
    expect($('.card').getAttribute('style')?.replace(/;$/, '')).toBe('border: 1px solid red');
    expect($('img').getAttribute('style')).toBeNull();
  });

  it('keeps the overlay when cleanup is false', async () => {
    const crew = assemble('#app', { cleanup: false });
    crew.finish();
    await crew.finished;
    expect($('.cc-layer')).toBeTruthy();
    expect($('h1').style.visibility).toBe('visible');
    crew.destroy();
    expect($('.cc-layer')).toBeNull();
  });

  it('fits the build into `duration` seconds', () => {
    const crew = assemble('#app', { duration: 4, autoplay: false });
    const tl = crew.timeline;
    expect(tl.duration() / tl.timeScale()).toBeCloseTo(4);
    crew.destroy();
  });

  it('replay() rebuilds from scratch', () => {
    const crew = assemble('#app', { agents: 2 });
    crew.replay();
    expect(document.querySelectorAll('.cc-layer')).toHaveLength(1);
    expect(document.querySelectorAll('.cc-agent')).toHaveLength(2);
    crew.destroy();
    expect($('h1').innerHTML).toBe('Hello crew');
  });

  it('caps the number of animated pieces with maxTasks by merging nested ones', () => {
    document.body.innerHTML = `<main id="app"><div style="background: #eee">${'<p>line</p>'.repeat(20)}</div></main>`;
    const crew = assemble('#app', { maxTasks: 5, autoplay: false });
    const hidden = Array.from(document.querySelectorAll<HTMLElement>('#app p')).filter((p) => p.style.visibility === 'hidden');
    expect(hidden).toHaveLength(4); // the box plus four paragraphs
    crew.destroy();
  });

  it('keeps text in a flex container as a single item while typing', async () => {
    document.body.innerHTML = `<main id="app"><div class="flexy" style="display: flex">Go now</div></main>`;
    const crew = assemble('#app', { autoplay: false });
    expect($('.flexy').children).toHaveLength(1);
    expect($('.flexy').children[0].textContent).toBe('Go now');
    expect($('.flexy').querySelectorAll('[data-cc-chunk]')).toHaveLength('Gonow'.length);
    crew.finish();
    await crew.finished;
    expect($('.flexy').innerHTML).toBe('Go now');
  });

  it('treats only zero-alpha colors as transparent', async () => {
    document.body.innerHTML = `<main id="app">
      <div class="black" style="border: 1px solid black"><p>a</p></div>
      <div class="clear" style="background: rgba(0, 0, 0, 0)"><p>b</p></div></main>`;
    const crew = assemble('#app', { autoplay: false });
    expect($('.black').style.visibility).toBe('hidden');
    expect($('.clear').style.visibility).toBe('');
    crew.destroy();
  });

  it('skips the animation for reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    const onComplete = vi.fn();
    const crew = assemble('#app', { onComplete });
    await crew.finished;
    await Promise.resolve();
    expect($('.cc-layer')).toBeNull();
    expect($('#app').hasAttribute('data-assemble-pending')).toBe(false);
    expect(onComplete).toHaveBeenCalled();
  });

  it('throws on a missing target', () => {
    expect(() => assemble('#nope')).toThrow(/target not found/);
  });
});
