// Keeps scrollbars hidden until a scroll area is hovered (CSS) or has just scrolled (this file).
const SCROLL_VISIBLE_MS = 900

export function installScrollbarVisibility(target: Document = document): void {
  const hideTimers = new WeakMap<Element, number>()

  target.addEventListener(
    'scroll',
    event => {
      const element = event.target === target ? target.documentElement : event.target
      if (!(element instanceof Element)) {
        return
      }
      element.setAttribute('data-scrolling', '')
      window.clearTimeout(hideTimers.get(element))
      hideTimers.set(
        element,
        window.setTimeout(() => element.removeAttribute('data-scrolling'), SCROLL_VISIBLE_MS),
      )
    },
    { capture: true, passive: true },
  )
}
