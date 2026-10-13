import type { FeedbackMessagePart } from './types.js'

export function getSafeDeliveryUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value, document.baseURI)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
}

export function renderFeedbackMessage(
  status: HTMLElement,
  message: string,
  parts?: FeedbackMessagePart[],
): void {
  status.textContent = message
  if (!parts) return

  status.replaceChildren()
  for (const part of parts) {
    const url = getSafeDeliveryUrl(part.url)
    if (!url) {
      status.append(document.createTextNode(part.text))
      continue
    }
    const link = document.createElement('a')
    link.textContent = part.text
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.style.color = 'inherit'
    link.style.textDecoration = 'underline'
    status.append(link)
  }
}
