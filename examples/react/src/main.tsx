import React from 'react'
import { createRoot } from 'react-dom/client'
import { initSnapfeed, type SnapfeedPlugin } from '@snapfeed/client'
import { App } from './App'
import './styles.css'

const endpoint =
  import.meta.env.VITE_SNAPFEED_ENDPOINT ?? 'http://127.0.0.1:8420/api/telemetry/events'

const fixturePlugin: SnapfeedPlugin = {
  name: 'fixture-markers',
  enrichElement(el) {
    const host = el.closest('[data-component]')
    if (!host) return null

    const lineValue = host.getAttribute('data-source-line')
    return {
      componentName: host.getAttribute('data-component') ?? undefined,
      fileName: host.getAttribute('data-source-file') ?? undefined,
      lineNumber: lineValue ? Number(lineValue) : undefined,
      variant: host.getAttribute('data-variant') ?? undefined,
    }
  },
}

initSnapfeed({
  endpoint,
  flushIntervalMs: 250,
  trackClicks: true,
  trackNavigation: true,
  trackErrors: true,
  trackApiErrors: true,
  captureConsoleErrors: true,
  feedback: {
    enabled: true,
    annotations: true,
    allowContextToggle: true,
    allowScreenshotToggle: true,
    defaultIncludeContext: true,
    defaultIncludeScreenshot: true,
  },
  user: {
    name: 'React E2E Lab',
    email: 'lab@snapfeed.local',
  },
  plugins: [fixturePlugin],
})

const container = document.getElementById('root')

if (!container) {
  throw new Error('Unable to find #root mount node for the React E2E app')
}

createRoot(container).render(
  <React.Fragment>
    <App />
  </React.Fragment>,
)