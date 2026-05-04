/**
 * Slack adapter — posts feedback to a Slack channel via incoming webhook.
 *
 * Uses Slack Block Kit for rich formatting.
 */

import type { AdapterResult, FeedbackAdapter, TelemetryEvent } from '../types.js'

export interface SlackAdapterOptions {
  /** Slack incoming webhook URL. */
  webhookUrl: string
  /** Channel override (only works with legacy webhooks). */
  channel?: string
  /** Bot username. Default: 'Snapfeed' */
  username?: string
  /** Bot icon emoji. Default: ':telescope:' */
  iconEmoji?: string
}

export function slackAdapter(options: SlackAdapterOptions): FeedbackAdapter {
  return {
    name: 'slack',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      try {
        const detail = event.detail ?? {}
        const message = (detail.message as string) || event.target || 'No message'
        const page = event.page || 'unknown'

        const blocks: unknown[] = [
          {
            type: 'header',
            text: { type: 'plain_text', text: '📝 New Feedback', emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: message },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `*Page:* \`${page}\`` },
              { type: 'mrkdwn', text: `*Time:* ${event.ts}` },
            ],
          },
        ]

        if (detail.user) {
          const user = detail.user as Record<string, unknown>
          const userStr = [user.name, user.email].filter(Boolean).join(' — ')
          if (userStr) {
            blocks.push({
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `*User:* ${userStr}` }],
            })
          }
        }

        if (detail.consoleErrors) {
          const errors = detail.consoleErrors as string[]
          if (errors.length > 0) {
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Console Errors:*\n\`\`\`${errors.slice(0, 5).join('\n')}\`\`\``,
              },
            })
          }
        }

        const payload: Record<string, unknown> = {
          blocks,
          text: `📝 Feedback: ${message.substring(0, 100)}`,
          username: options.username ?? 'Snapfeed',
          icon_emoji: options.iconEmoji ?? ':telescope:',
        }
        if (options.channel) payload.channel = options.channel

        const res = await fetch(options.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          return { ok: false, error: `Slack webhook ${res.status}` }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    },
  }
}
