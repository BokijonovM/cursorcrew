import { createElement, useEffect, useLayoutEffect, useRef, type ElementType, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { assemble, type AssembleOptions, type Crew } from './index';

// useLayoutEffect warns during SSR; it only matters in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Runs cursorcrew on `ref.current` once it mounts, and restores it on unmount.
 * Options are read on mount; change the component's `key` to rebuild with new ones.
 */
export function useAssemble(ref: RefObject<Element | null>, options?: AssembleOptions): RefObject<Crew | null> {
  const crew = useRef<Crew | null>(null);
  const opts = useRef(options);
  opts.current = options;

  useIsoLayoutEffect(() => {
    if (!ref.current) return;
    const c = assemble(ref.current, {
      ...opts.current,
      onStart: () => opts.current?.onStart?.(),
      onProgress: (p) => opts.current?.onProgress?.(p),
      onComplete: () => opts.current?.onComplete?.(),
    });
    crew.current = c;
    return () => {
      c.destroy();
      crew.current = null;
    };
  }, [ref]);

  return crew;
}

export interface AssembleProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. Default `div`. */
  as?: ElementType;
  options?: AssembleOptions;
  children?: ReactNode;
}

/** Wraps its children and builds them with a crew of cursors on mount. */
export function Assemble({ as = 'div', options, children, ...rest }: AssembleProps) {
  const ref = useRef<HTMLElement>(null);
  useAssemble(ref, options);
  return createElement(as, { ...rest, ref, 'data-assemble-pending': '' }, children);
}

export type { AssembleOptions, Crew } from './index';
