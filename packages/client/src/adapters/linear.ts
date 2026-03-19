/**
 * Linear adapter — creates Linear issues from feedback via GraphQL API.
 *
 * Requires a Linear API key and team ID.
 */

import type { AdapterResult, FeedbackAdapter, TelemetryEvent } from '../types.js'

export interface LinearAdapterOptions {
  /** Linear API key. */
  apiKey: string
  /** Linear team ID to create issues in. */
  teamId: string
  /** Label IDs to apply. */
  labelIds?: string[]
  /** Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low). Default: 3 */
  priority?: number
}

const CATEGORY_LABEL: Record<string, string> = {
  bug: '🐛 Bug',
  idea: '💡 Idea',
  question: '❓ Question',
  praise: '🙌 Praise',
  other: '📝 Feedback',
}

export function linearAdapter(options: LinearAdapterOptions): FeedbackAdapter {
  const { apiKey, teamId } = options
  const priority = options.priority ?? 3

  return {
    name: 'linear',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      try {
        const detail = event.detail ?? {}
        const category = (detail.category as string) || 'other'
        const message = (detail.message as string) || event.target || 'No message'
        const page = event.page || 'unknown'
        const label = CATEGORY_LABEL[category] || '📝 Feedback'

        const descLines: string[] = [
          `**${label}**`,
          '',
          message,
          '',
          `---`,
          `**Page:** \`${page}\``,
          `**Time:** ${event.ts}`,
        ]

        if (detail.user) {
          const user = detail.user as Record<string, unknown>
          if (user.name) descLines.push(`**User:** ${user.name}`)
          if (user.email) descLines.push(`**Email:** ${user.email}`)
        }

        if (detail.consoleErrors) {
          const errors = detail.consoleErrors as string[]
          if (errors.length > 0) {
            descLines.push('', '**Console Errors:**', '```', ...errors.slice(0, 10), '```')
          }
        }

        if (event.screenshot) {
          descLines.push('', `![screenshot](data:image/jpeg;base64,${event.screenshot})`)
        }

        const title = `[Feedback] ${message.substring(0, 80)}${message.length > 80 ? '…' : ''}`
        const description = descLines.join('\n')

        const mutation = `
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue { id identifier url }
            }
          }
        `

        const input: Record<string, unknown> = {
          teamId,
          title,
          description,
          priority,
        }
        if (options.labelIds?.length) {
          input.labelIds = options.labelIds
        }

        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: mutation, variables: { input } }),
        })

        if (!res.ok) {
          const err = await res.text()
          return { ok: false, error: `Linear API ${res.status}: ${err}` }
        }

        const data = (await res.json()) as {
          data?: { issueCreate?: { success: boolean; issue?: { identifier: string } } }
          errors?: Array<{ message: string }>
        }

        if (data.errors?.length) {
          return { ok: false, error: data.errors[0].message }
        }

        const identifier = data.data?.issueCreate?.issue?.identifier
        return { ok: true, deliveryId: identifier ?? undefined }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    },
  }
}
