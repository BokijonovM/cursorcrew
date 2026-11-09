/** Splits an element's text into hidden spans that can be revealed one by one. */

export type TypingMode = 'auto' | 'char' | 'word';

export interface TextSplit {
  chunks: HTMLSpanElement[];
  /** Puts the original text nodes back. Safe to call more than once. */
  restore(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Segmenter = typeof Intl !== 'undefined' ? (Intl as any).Segmenter : undefined;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s: string): string[] =>
  segmenter ? Array.from(segmenter.segment(s) as Iterable<{ segment: string }>, (x) => x.segment) : Array.from(s);

/** Text longer than this many characters is typed word by word in `auto` mode. */
const WORD_THRESHOLD = 160;

export function splitText(el: Element, mode: TypingMode): TextSplit {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,svg,textarea')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const length = nodes.reduce((n, t) => n + (t.nodeValue || '').trim().length, 0);
  const byWord = mode === 'word' || (mode === 'auto' && length > WORD_THRESHOLD);

  const chunks: HTMLSpanElement[] = [];
  const replaced: { original: Text; created: Node[] }[] = [];

  for (const node of nodes) {
    const value = node.nodeValue || '';
    if (!value.trim()) continue;
    const pieces = byWord ? value.match(/\s+|\S+/g) || [] : graphemes(value);
    const fragment = document.createDocumentFragment();
    const created: Node[] = [];
    for (const piece of pieces) {
      let out: Node;
      if (!piece.trim()) {
        out = document.createTextNode(piece);
      } else {
        const span = document.createElement('span');
        span.textContent = piece;
        span.style.visibility = 'hidden';
        span.setAttribute('data-cc-chunk', '');
        chunks.push(span);
        out = span;
      }
      fragment.appendChild(out);
      created.push(out);
    }
    node.parentNode!.insertBefore(fragment, node);
    node.parentNode!.removeChild(node);
    replaced.push({ original: node, created });
  }

  let restored = false;
  return {
    chunks,
    restore() {
      if (restored) return;
      restored = true;
      for (const { original, created } of replaced) {
        const first = created[0];
        if (first && first.parentNode) first.parentNode.insertBefore(original, first);
        for (const n of created) n.parentNode?.removeChild(n);
      }
    },
  };
}
