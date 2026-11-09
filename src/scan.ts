/** Walks a DOM subtree and turns it into an ordered list of build tasks. */

export type StyledElement = Element & ElementCSSInlineStyle;
export type TaskKind = 'box' | 'text' | 'media' | 'block';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Task {
  id: number;
  el: StyledElement;
  kind: TaskKind;
  /** Whether the element paints a surface (fill, border, shadow) that gets drawn first. */
  hasBox: boolean;
  /** Position relative to the overlay layer. */
  rect: Rect;
  /** Index of the nearest ancestor task, or -1. Children wait for their parent. */
  parent: number;
  label: string;
  area: number;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'TITLE', 'BR', 'WBR', 'SOURCE', 'TRACK']);
const MEDIA_TAGS = new Set(['IMG', 'SVG', 'svg', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME', 'OBJECT', 'EMBED']);
const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'PROGRESS', 'METER']);

/** Only a zero *alpha* counts: rgba(r, g, b, 0) or modern `… / 0` syntax. rgb(255, 0, 0) is red, not transparent. */
const isTransparent = (c: string | null | undefined): boolean =>
  !c ||
  c === 'transparent' ||
  /^rgba?\([^,)]+,[^,)]+,[^,)]+,\s*0*\.?0*%?\s*\)$/.test(c) ||
  /\/\s*0*\.?0*%?\s*\)$/.test(c);

function paintsSurface(cs: CSSStyleDeclaration): boolean {
  if (!isTransparent(cs.backgroundColor)) return true;
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
  if (cs.boxShadow && cs.boxShadow !== 'none') return true;
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const width = parseFloat(cs[`border${side}Width`]);
    const style = cs[`border${side}Style`];
    if (width > 0 && style !== 'none' && style !== 'hidden' && !isTransparent(cs[`border${side}Color`])) return true;
  }
  return false;
}

function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) return true;
  }
  return false;
}

/** True when every descendant is inline, so the element can be typed as one text run. */
function onlyInlineDescendants(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (child.tagName === 'BR') continue;
    if (MEDIA_TAGS.has(child.tagName) || CONTROL_TAGS.has(child.tagName)) return false;
    if (getComputedStyle(child).display !== 'inline' || !onlyInlineDescendants(child)) return false;
  }
  return true;
}

function isInlineTextBlock(el: Element): boolean {
  if (!el.textContent || !el.textContent.trim()) return false;
  for (const child of Array.from(el.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (MEDIA_TAGS.has(child.tagName) || CONTROL_TAGS.has(child.tagName)) return false;
    const display = getComputedStyle(child).display;
    if ((display !== 'inline' && display !== 'contents') || !onlyInlineDescendants(child)) return false;
  }
  return true;
}

function labelFor(el: Element, kind: TaskKind): string {
  if (kind === 'text') {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return `“${text.length > 18 ? text.slice(0, 17) + '…' : text}”`;
  }
  const tag = el.tagName.toLowerCase();
  if (kind === 'media') return tag === 'img' || tag === 'picture' ? 'image' : tag;
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
  return cls ? `${tag}.${cls.slice(0, 16)}` : tag;
}

export function collectTasks(root: Element, origin: DOMRect, maxTasks: number): Task[] {
  const tasks: Task[] = [];

  const add = (el: Element, kind: TaskKind, hasBox: boolean, parent: number): number => {
    const r = el.getBoundingClientRect();
    const rect = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
    tasks.push({ id: tasks.length, el: el as StyledElement, kind, hasBox, rect, parent, label: labelFor(el, kind), area: rect.w * rect.h });
    return tasks.length - 1;
  };

  const walk = (el: Element, parent: number, isRoot: boolean): void => {
    if (SKIP_TAGS.has(el.tagName)) return;
    const mode = el.getAttribute('data-assemble');
    if (mode === 'skip') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;

    const r = el.getBoundingClientRect();
    const visible = r.width >= 2 && r.height >= 2;
    const tag = el.tagName;

    if (visible && !(isRoot && (tag === 'BODY' || tag === 'HTML'))) {
      if (mode === 'block') return void add(el, 'block', false, parent);
      if (MEDIA_TAGS.has(tag)) return void add(el, 'media', false, parent);
      if (CONTROL_TAGS.has(tag)) return void add(el, 'box', true, parent);
      const box = paintsSurface(cs);
      if (hasOwnText(el) || isInlineTextBlock(el)) return void add(el, 'text', box, parent);
      if (box) parent = add(el, 'box', true, parent);
    }
    for (const child of Array.from(el.children)) walk(child, parent, false);
  };

  walk(root, -1, true);
  if (tasks.length <= maxTasks) return tasks;

  // Too many tasks: drop the smallest nested ones and re-parent their children.
  const dropped = new Set<number>();
  for (const t of tasks.filter((t) => t.parent !== -1).sort((a, b) => a.area - b.area)) {
    if (tasks.length - dropped.size <= maxTasks) break;
    dropped.add(t.id);
  }
  const keptAncestor = (p: number): number => {
    while (p !== -1 && dropped.has(p)) p = tasks[p].parent;
    return p;
  };
  const kept = tasks.filter((t) => !dropped.has(t.id));
  const newIndex = new Map<number, number>();
  kept.forEach((t, i) => newIndex.set(t.id, i));
  for (const t of kept) {
    const p = keptAncestor(t.parent);
    t.parent = p === -1 ? -1 : newIndex.get(p)!;
  }
  kept.forEach((t, i) => (t.id = i));
  return kept;
}
