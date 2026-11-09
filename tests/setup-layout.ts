/** jsdom has no layout; give every element a plausible box so tasks are detected. */
export function fakeLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const i = Array.prototype.indexOf.call(document.querySelectorAll('*'), this);
    const top = 10 + i * 30;
    return { x: 10, y: top, left: 10, top, right: 410, bottom: top + 24, width: 400, height: 24, toJSON() {} } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}
