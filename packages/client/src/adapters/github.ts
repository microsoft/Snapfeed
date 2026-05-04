/**
 * GitHub Issues adapter — creates a GitHub issue for each feedback event.
 */

import type { AdapterResult, FeedbackAdapter, TelemetryEvent } from '../types.js'

export interface GitHubAdapterOptions {
  /** GitHub personal access token with `repo` scope. */
  token: string
  /** Repository owner (user or org). */
  owner: string
  /** Repository name. */
  repo: string
  /** Labels to apply to created issues. Default: ['feedback'] */
  labels?: string[]
}

export function githubAdapter(options: GitHubAdapterOptions): FeedbackAdapter {
  const { token, owner, repo } = options
  const labels = options.labels ?? ['feedback']

  return {
    name: 'github',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      try {
        const detail = event.detail ?? {}
        const message = (detail.message as string) || event.target || 'No message'
        const page = event.page || 'unknown'

        const lines: string[] = [`**Page:** \`${page}\``, `**Timestamp:** ${event.ts}`]

        if (detail.user) {
          const user = detail.user as Record<string, unknown>
          if (user.name) lines.push(`**User:** ${user.name}`)
          if (user.email) lines.push(`**Email:** ${user.email}`)
        }

        lines.push('', '### Message', '', message)

        if (detail.consoleErrors) {
          const errors = detail.consoleErrors as string[]
          if (errors.length > 0) {
            lines.push('', '### Recent Console Errors', '', '```', ...errors.slice(0, 10), '```')
          }
        }

        if (event.screenshot) {
          lines.push(
            '',
            '### Screenshot',
            '',
            `![feedback screenshot](data:image/jpeg;base64,${event.screenshot})`,
          )
        }

        const body = lines.join('\n')
        const title = `[Feedback] ${message.substring(0, 80)}${message.length > 80 ? '…' : ''}`

        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ title, body, labels }),
        })

        if (!res.ok) {
          const err = await res.text()
          return { ok: false, error: `GitHub API ${res.status}: ${err}` }
        }

        const issue = (await res.json()) as { number: number }
        return { ok: true, deliveryId: String(issue.number) }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    },
  }
}
