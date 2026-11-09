/** The overlay layer: cursors, draw boxes and carets, plus their stylesheet. */

export interface AgentConfig {
  name: string;
  color: string;
}

export interface Agent {
  el: HTMLDivElement;
  tag: HTMLDivElement;
  caret: HTMLDivElement;
  config: AgentConfig;
}

export const DEFAULT_AGENTS: readonly AgentConfig[] = [
  { name: 'Atlas', color: '#6d5efc' },
  { name: 'Nova', color: '#f2547d' },
  { name: 'Echo', color: '#12a8a0' },
  { name: 'Pixel', color: '#f08a24' },
  { name: 'Orbit', color: '#2f80ed' },
  { name: 'Juno', color: '#9b51e0' },
  { name: 'Sol', color: '#d4a20b' },
  { name: 'Kai', color: '#27ae60' },
];

export function resolveAgents(agents: number | readonly AgentConfig[] | undefined): AgentConfig[] {
  if (Array.isArray(agents) && agents.length) return agents.slice();
  const count = Math.min(24, Math.max(1, typeof agents === 'number' ? Math.round(agents) : 5));
  return Array.from({ length: count }, (_, i) => {
    const base = DEFAULT_AGENTS[i % DEFAULT_AGENTS.length];
    return i < DEFAULT_AGENTS.length ? { ...base } : { name: `${base.name} ${Math.floor(i / DEFAULT_AGENTS.length) + 1}`, color: base.color };
  });
}

const STYLE_ID = 'cursorcrew-css';

const CSS = `
[data-assemble-pending]{visibility:hidden}
.cc-layer{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none}
.cc-layer *{box-sizing:border-box}
.cc-agent{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;z-index:3}
.cc-ic{position:absolute;display:none;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))}
.cc-agent[data-mode=arrow] .cc-arrow,.cc-agent[data-mode=cross] .cc-cross,.cc-agent[data-mode=beam] .cc-beam{display:block}
.cc-arrow{left:-1px;top:-1px;width:18px;height:22px}
.cc-cross{left:-9px;top:-9px;width:18px;height:18px}
.cc-beam{left:-5px;top:-10px;width:10px;height:20px}
.cc-tag{position:absolute;left:14px;top:18px;display:flex;align-items:center;gap:6px;white-space:nowrap;
  font:600 11px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:var(--c);
  padding:4px 7px;border-radius:2px 8px 8px 8px;box-shadow:0 2px 6px rgba(0,0,0,.18);letter-spacing:.01em}
.cc-tag::after{content:attr(data-action);font-weight:500;opacity:.82;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.cc-tag[data-action=""]::after{display:none}
.cc-noactions .cc-tag::after{display:none}
.cc-nolabels .cc-tag{display:none}
.cc-draw{position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;opacity:0;z-index:1;
  border:1.5px solid var(--c);background:color-mix(in srgb,var(--c) 7%,transparent)}
.cc-draw[data-kind=text]{border-style:dashed;background:none}
.cc-draw[data-kind=media],.cc-draw[data-kind=block]{background:repeating-linear-gradient(135deg,
  color-mix(in srgb,var(--c) 14%,transparent) 0 6px,color-mix(in srgb,var(--c) 4%,transparent) 6px 12px)}
.cc-dim{position:absolute;left:50%;top:100%;transform:translate(-50%,5px);font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#fff;background:var(--c);padding:3px 5px;border-radius:3px;white-space:nowrap}
.cc-caret{position:absolute;left:0;top:0;width:2px;visibility:hidden;opacity:0;z-index:2;background:var(--c)}
`;

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** A full-document, click-through layer the crew draws on. */
export function createLayer(zIndex: number, labels: boolean, actions: boolean): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'cc-layer' + (labels ? '' : ' cc-nolabels') + (actions ? '' : ' cc-noactions');
  layer.setAttribute('aria-hidden', 'true');
  const doc = document.documentElement;
  layer.style.width = Math.max(doc.scrollWidth, document.body.scrollWidth) + 'px';
  layer.style.height = Math.max(doc.scrollHeight, document.body.scrollHeight) + 'px';
  layer.style.zIndex = String(zIndex);
  document.body.appendChild(layer);
  return layer;
}

const ICONS =
  '<svg class="cc-ic cc-arrow" viewBox="0 0 18 22"><path d="M1.5 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6z" fill="var(--c)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>' +
  '<svg class="cc-ic cc-cross" viewBox="0 0 18 18"><path d="M9 1v16M1 9h16" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="M9 1v16M1 9h16" stroke="var(--c)" stroke-width="1.6" stroke-linecap="round"/></svg>' +
  '<svg class="cc-ic cc-beam" viewBox="0 0 10 20"><path d="M2 1.5h6M5 1.5v17M2 18.5h6" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="M2 1.5h6M5 1.5v17M2 18.5h6" stroke="var(--c)" stroke-width="1.6" stroke-linecap="round"/></svg>';

export function createAgent(layer: HTMLElement, config: AgentConfig): Agent {
  const el = document.createElement('div');
  el.className = 'cc-agent';
  el.dataset.mode = 'arrow';
  el.style.setProperty('--c', config.color);
  el.innerHTML = ICONS;

  const tag = document.createElement('div');
  tag.className = 'cc-tag';
  tag.textContent = config.name;
  tag.setAttribute('data-action', '');
  el.appendChild(tag);

  const caret = document.createElement('div');
  caret.className = 'cc-caret';
  caret.style.setProperty('--c', config.color);

  layer.appendChild(el);
  layer.appendChild(caret);
  return { el, tag, caret, config };
}

export function createDrawBox(layer: HTMLElement, kind: string, color: string, withSize: boolean) {
  const box = document.createElement('div');
  box.className = 'cc-draw';
  box.dataset.kind = kind;
  box.style.setProperty('--c', color);
  let size: HTMLDivElement | null = null;
  if (withSize) {
    size = document.createElement('div');
    size.className = 'cc-dim';
    box.appendChild(size);
  }
  layer.appendChild(box);
  return { box, size };
}
