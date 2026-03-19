/**
 * DOM element description helpers.
 *
 * These build human-readable identifiers for DOM elements,
 * used in telemetry events so agents can understand what was clicked.
 */

/** Build a compact description: tag#id.class1.class2 */
export function describeElement(el: Element): string {
  const parts: string[] = [el.tagName.toLowerCase()]
  if (el.id) parts.push(`#${el.id}`)
  const cls = el.className
  if (typeof cls === 'string' && cls) {
    const meaningful = cls.split(/\s+/).filter((c) => !c.startsWith('css-')).slice(0, 3)
    if (meaningful.length) parts.push(`.${meaningful.join('.')}`)
  }
  return parts.join('')
}

/** Build a CSS-selector-like path, up to 5 ancestors deep. */
export function getPath(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && parts.length < 5) {
    parts.unshift(describeElement(cur))
    cur = cur.parentElement
  }
  return parts.join(' > ')
}

/** First 80 chars of the element's visible text. */
export function getText(el: Element): string {
  const text = (el as HTMLElement).innerText ?? el.textContent ?? ''
  return text.trim().substring(0, 80).replace(/\n/g, ' ')
}

/** Best available label: aria-label → title → button text → innerText → tagName. */
export function getLabel(el: Element): string {
  return el.getAttribute('aria-label')
    || el.getAttribute('title')
    || (el.closest('button, a, [role="button"]') as HTMLElement)?.innerText?.trim().substring(0, 60)
    || getText(el)
    || el.tagName.toLowerCase()
}
