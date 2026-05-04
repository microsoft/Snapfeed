/**
 * Discord adapter — posts feedback to a Discord channel via webhook.
 *
 * Uses Discord embed format for rich messages. Screenshots are included
 * as base64 data URL images in the embed.
 */

import type { AdapterResult, FeedbackAdapter, TelemetryEvent } from '../types.js'

export interface DiscordAdapterOptions {
  /** Discord webhook URL. */
  webhookUrl: string
  /** Bot username override. Default: 'Snapfeed' */
  username?: string
  /** Bot avatar URL. */
  avatarUrl?: string
}

export function discordAdapter(options: DiscordAdapterOptions): FeedbackAdapter {
  return {
    name: 'discord',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      try {
        const detail = event.detail ?? {}
        const message = (detail.message as string) || event.target || 'No message'
        const page = event.page || 'unknown'

        const fields: Array<{ name: string; value: string; inline?: boolean }> = [
          { name: '📍 Page', value: `\`${page}\``, inline: true },
          { name: '🕐 Time', value: event.ts, inline: true },
        ]

        if (detail.user) {
          const user = detail.user as Record<string, unknown>
          const userStr = [user.name, user.email].filter(Boolean).join(' — ')
          if (userStr) {
            fields.push({ name: '👤 User', value: userStr, inline: true })
          }
        }

        if (detail.consoleErrors) {
          const errors = detail.consoleErrors as string[]
          if (errors.length > 0) {
            fields.push({
              name: '🔴 Console Errors',
              value: `\`\`\`\n${errors.slice(0, 5).join('\n')}\n\`\`\``,
            })
          }
        }

        const embed: Record<string, unknown> = {
          title: '📝 Feedback',
          description: message,
          color: 0x99aab5,
          fields,
          timestamp: event.ts,
        }

        const payload: Record<string, unknown> = {
          username: options.username ?? 'Snapfeed',
          embeds: [embed],
        }
        if (options.avatarUrl) payload.avatar_url = options.avatarUrl

        // Discord webhooks support multipart for file uploads
        if (event.screenshot) {
          const form = new FormData()
          form.append('payload_json', JSON.stringify(payload))
          const blob = base64ToBlob(event.screenshot, 'image/jpeg')
          form.append('files[0]', blob, 'screenshot.jpg')
          // Reference the attachment in the embed
          embed.image = { url: 'attachment://screenshot.jpg' }
          form.set('payload_json', JSON.stringify(payload))

          const res = await fetch(options.webhookUrl, { method: 'POST', body: form })
          if (!res.ok) {
            const err = await res.text()
            return { ok: false, error: `Discord webhook ${res.status}: ${err}` }
          }
          return { ok: true }
        }

        const res = await fetch(options.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const err = await res.text()
          return { ok: false, error: `Discord webhook ${res.status}: ${err}` }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    },
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}
