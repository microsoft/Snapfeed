// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderFeedbackMessage } from './feedback-status.js'

describe('feedback status DOM rendering', () => {
  it('renders plain completion messages literally', () => {
    const status = document.createElement('div')
    const message = '<img src=x onerror=alert(1)>'
    renderFeedbackMessage(status, message)
    expect(status.textContent).toBe(message)
    expect(status.querySelector('img')).toBeNull()
  })

  it('revalidates custom controller link parts at the rendering boundary', () => {
    const status = document.createElement('div')
    renderFeedbackMessage(status, 'Delivered', [
      { text: '<svg onload=alert(1)>', url: 'java\nscript:alert(2)' },
      { text: 'Safe link', url: '/reports/1' },
    ])
    expect(status.querySelector('svg')).toBeNull()
    expect(status.querySelectorAll('a')).toHaveLength(1)
    expect(status.querySelector('a')?.textContent).toBe('Safe link')
    expect(status.textContent).toBe('<svg onload=alert(1)>Safe link')
  })

  it('clears links when the status returns to plain text', () => {
    const status = document.createElement('div')
    renderFeedbackMessage(status, 'Delivered', [{ text: 'Report', url: '/reports/1' }])
    renderFeedbackMessage(status, 'Sending...')
    expect(status.textContent).toBe('Sending...')
    expect(status.querySelector('a')).toBeNull()
  })
})
