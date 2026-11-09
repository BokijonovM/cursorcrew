import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Assemble } from '../src/react';
import { fakeLayout } from './setup-layout';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = fakeLayout();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => restoreLayout());

it('<Assemble> builds on mount and restores on unmount', () => {
  const root = createRoot(document.getElementById('root')!);
  act(() => {
    root.render(
      <Assemble as="section" className="hero" options={{ agents: 2, autoplay: false }}>
        <h1>Hi there</h1>
      </Assemble>,
    );
  });
  const section = document.querySelector('section.hero') as HTMLElement;
  expect(section).toBeTruthy();
  expect(document.querySelectorAll('.cc-agent')).toHaveLength(2);
  expect(section.style.visibility).toBe('hidden');

  act(() => root.unmount());
  expect(document.querySelector('.cc-layer')).toBeNull();
});
