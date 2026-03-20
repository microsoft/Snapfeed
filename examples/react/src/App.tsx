import { useEffect, useState } from 'react'

type RoutePath = '/' | '/network' | '/feedback' | '/failures'

type DemoAction = {
  id: string
  title: string
  description: string
  cta: string
  onRun: () => Promise<string> | string
}

type SnapfeedWindow = Window & {
  __snapfeed?: {
    sessionId?: string
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8420'

const routes: Array<{ path: RoutePath; label: string; eyebrow: string }> = [
  { path: '/', label: 'Overview', eyebrow: 'Boot and click coverage' },
  { path: '/network', label: 'Network Lab', eyebrow: 'API and fetch failures' },
  { path: '/feedback', label: 'Feedback Lab', eyebrow: 'Cmd/Ctrl click capture' },
  { path: '/failures', label: 'Failure Lab', eyebrow: 'Runtime exceptions' },
]

const overviewActions: DemoAction[] = [
  {
    id: 'server-ping',
    title: 'Ping the server',
    description: 'Confirms the browser can reach the SQLite-backed API server.',
    cta: 'Run ping',
    async onRun() {
      const response = await fetch(`${apiBaseUrl}/api/mock/ok`)
      const payload = (await response.json()) as { status: string }
      return `Server responded with ${payload.status}.`
    },
  },
  {
    id: 'console-seed',
    title: 'Seed console errors',
    description: 'Adds console.error entries so feedback context can include them.',
    cta: 'Log console errors',
    onRun() {
      console.error('Snapfeed E2E seeded console error', { source: 'overview', at: Date.now() })
      console.error('Snapfeed E2E second console error', { route: window.location.pathname })
      return 'Console errors written for feedback context.'
    },
  },
]

const networkActions: DemoAction[] = [
  {
    id: 'api-failure',
    title: 'Trigger a 503 response',
    description: 'Exercises the api_error capture path with a real non-2xx response.',
    cta: 'Call failing API',
    async onRun() {
      const response = await fetch(`${apiBaseUrl}/api/mock/failure?code=503`)
      return `Received ${response.status} from the mock API.`
    },
  },
  {
    id: 'network-failure',
    title: 'Trigger a network failure',
    description: 'Fetches an unused local port so the client records network_error telemetry.',
    cta: 'Call dead port',
    async onRun() {
      try {
        await fetch('http://127.0.0.1:9/snapfeed-network-failure')
      } catch {
        return 'Fetch rejected because the target port is closed.'
      }
      return 'Unexpectedly reached the dead port.'
    },
  },
]

const failureActions: DemoAction[] = [
  {
    id: 'throw-window-error',
    title: 'Throw a window error',
    description: 'Throws asynchronously so window.onerror receives a real uncaught error.',
    cta: 'Throw error',
    onRun() {
      window.setTimeout(() => {
        throw new Error('Snapfeed simulated uncaught window error')
      }, 0)
      return 'Scheduled an uncaught error.'
    },
  },
  {
    id: 'reject-promise',
    title: 'Reject an unhandled promise',
    description: 'Creates an unhandled rejection so the client records another error event.',
    cta: 'Reject promise',
    onRun() {
      window.setTimeout(() => {
        void Promise.reject(new Error('Snapfeed simulated unhandled rejection'))
      }, 0)
      return 'Scheduled an unhandled rejection.'
    },
  },
]

const feedbackChecklist = [
  'Cmd/Ctrl-click the review card to open the feedback dialog.',
  'Type a note, expand Details if you want to inspect the payload, then send it.',
  'The dialog should attach a screenshot and the visible form state by default.',
]

function getRoute(pathname: string): RoutePath {
  return routes.find((route) => route.path === pathname)?.path ?? '/'
}

function navigate(path: RoutePath, onChange: (route: RoutePath) => void): void {
  if (window.location.pathname === path) return
  history.pushState({}, '', path)
  onChange(path)
}

function getSessionId(): string {
  return (window as SnapfeedWindow).__snapfeed?.sessionId ?? 'pending'
}

function OverviewPanel({ onRun }: { onRun: (action: DemoAction) => Promise<void> }) {
  return (
    <div className="panel-grid">
      {overviewActions.map((action) => (
        <ActionCard key={action.id} action={action} onRun={onRun} />
      ))}
      <article
        className="hero-card"
        data-component="SignalCard"
        data-source-file="src/App.tsx"
        data-source-line="132"
        data-variant="overview"
        data-testid="hero-click-target"
      >
        <p className="hero-eyebrow">Click target</p>
        <h2>Signal card</h2>
        <p>
          Any click in this panel produces a regular click event enriched with fixture component
          metadata.
        </p>
        <button className="ghost-button" type="button">
          Click me for telemetry
        </button>
      </article>
    </div>
  )
}

function NetworkPanel({ onRun }: { onRun: (action: DemoAction) => Promise<void> }) {
  return (
    <div className="panel-grid">
      {networkActions.map((action) => (
        <ActionCard key={action.id} action={action} onRun={onRun} />
      ))}
      <article className="status-panel">
        <p className="hero-eyebrow">Route objective</p>
        <h2>Capture server-side and transport failures</h2>
        <p>
          The first action returns a 503 from the local Hono server. The second fetches an unused
          port so the browser records a network failure before any response exists.
        </p>
      </article>
    </div>
  )
}

function FailurePanel({ onRun }: { onRun: (action: DemoAction) => Promise<void> }) {
  return (
    <div className="panel-grid">
      {failureActions.map((action) => (
        <ActionCard key={action.id} action={action} onRun={onRun} />
      ))}
      <article className="status-panel">
        <p className="hero-eyebrow">Route objective</p>
        <h2>Exercise both error capture paths</h2>
        <p>
          The client records runtime exceptions from window.onerror and unhandledrejection as
          separate error telemetry entries.
        </p>
      </article>
    </div>
  )
}

function FeedbackPanel() {
  const [reporter, setReporter] = useState('QA Operator')
  const [priority, setPriority] = useState('high')
  const [includeReleaseNotes, setIncludeReleaseNotes] = useState(true)

  return (
    <div className="feedback-layout">
      <section className="feedback-card-stack">
        <article
          className="feedback-target"
          data-component="FeedbackReviewCard"
          data-source-file="src/App.tsx"
          data-source-line="192"
          data-feedback-context="review-board"
          data-index="7"
          data-variant="feedback"
          data-testid="feedback-target"
        >
          <p className="hero-eyebrow">Feedback target</p>
          <h2>Review board card</h2>
          <p>
            This card is the intended Cmd/Ctrl-click target. The dialog should attach screenshot,
            console context, data attributes, and the form state shown on this route.
          </p>
          <div className="tag-row">
            <span>Screenshot</span>
            <span>Context</span>
            <span>Form state</span>
          </div>
        </article>
        <article className="status-panel compact">
          <p className="hero-eyebrow">Checklist</p>
          <ul className="checklist">
            {feedbackChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
      <aside className="control-panel">
        <p className="hero-eyebrow">Visible form state</p>
        <label className="field">
          <span>Reporter</span>
          <input
            aria-label="Reporter"
            value={reporter}
            onChange={(event) => setReporter(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Priority</span>
          <select
            aria-label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            aria-label="Attach release notes"
            checked={includeReleaseNotes}
            onChange={(event) => setIncludeReleaseNotes(event.target.checked)}
            type="checkbox"
          />
          <span>Attach release notes</span>
        </label>
        <p className="field-hint">
          These values are intentionally visible so gatherContext can include them in the feedback
          payload.
        </p>
      </aside>
    </div>
  )
}

function ActionCard({
  action,
  onRun,
}: {
  action: DemoAction
  onRun: (action: DemoAction) => Promise<void>
}) {
  return (
    <article className="action-card" data-testid={action.id}>
      <p className="hero-eyebrow">Scenario</p>
      <h2>{action.title}</h2>
      <p>{action.description}</p>
      <button className="primary-button" onClick={() => void onRun(action)} type="button">
        {action.cta}
      </button>
    </article>
  )
}

export function App() {
  const [route, setRoute] = useState<RoutePath>(() => getRoute(window.location.pathname))
  const [sessionId, setSessionId] = useState(() => getSessionId())
  const [lastAction, setLastAction] = useState('Ready. Use the nav and action panels to generate telemetry.')

  useEffect(() => {
    const syncRoute = () => setRoute(getRoute(window.location.pathname))
    const syncSession = () => setSessionId(getSessionId())

    syncRoute()
    syncSession()

    window.addEventListener('popstate', syncRoute)
    const timer = window.setInterval(syncSession, 250)

    return () => {
      window.removeEventListener('popstate', syncRoute)
      window.clearInterval(timer)
    }
  }, [])

  const activeRoute = routes.find((entry) => entry.path === route) ?? routes[0]

  const runAction = async (action: DemoAction) => {
    setLastAction(`Running ${action.title.toLowerCase()}...`)
    try {
      const result = await action.onRun()
      setLastAction(result)
    } catch (error) {
      setLastAction(
        error instanceof Error ? `Action failed: ${error.message}` : 'Action failed unexpectedly.',
      )
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="hero-kicker">Snapfeed React E2E Lab</p>
          <h1>Exercise the browser client against the real SQLite backend.</h1>
          <p className="hero-copy">
            This app exists to validate the full browser-to-database path, not to demonstrate a
            polished product UI. Every route intentionally targets a specific telemetry pathway.
          </p>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>Session</dt>
            <dd data-testid="session-id">{sessionId}</dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>{activeRoute.label}</dd>
          </div>
          <div>
            <dt>API base</dt>
            <dd>{apiBaseUrl}</dd>
          </div>
        </dl>
      </section>

      <section className="nav-shell">
        <div>
          <p className="hero-eyebrow">Navigation</p>
          <h2>{activeRoute.label}</h2>
          <p>{activeRoute.eyebrow}</p>
        </div>
        <nav className="nav-row" aria-label="Telemetry routes">
          {routes.map((entry) => (
            <button
              key={entry.path}
              className={entry.path === route ? 'nav-button active' : 'nav-button'}
              onClick={() => navigate(entry.path, setRoute)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </section>

      {route === '/' && <OverviewPanel onRun={runAction} />}
      {route === '/network' && <NetworkPanel onRun={runAction} />}
      {route === '/failures' && <FailurePanel onRun={runAction} />}
      {route === '/feedback' && <FeedbackPanel />}

      <section className="status-bar" aria-live="polite">
        <p className="hero-eyebrow">Last action</p>
        <p>{lastAction}</p>
      </section>
    </main>
  )
}