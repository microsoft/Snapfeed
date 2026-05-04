/**
 * Telegram adapter — sends feedback to a Telegram chat via Bot API.
 *
 * If a screenshot is attached, sends it as a photo with the message as caption.
 * Otherwise sends a formatted text message.
 */

import type { AdapterResult, FeedbackAdapter, TelemetryEvent } from '../types.js'

export interface TelegramAdapterOptions {
  /** Telegram Bot API token (from @BotFather). */
  botToken: string
  /** Chat ID to send messages to. Can be a group, channel, or user ID. */
  chatId: string | number
  /** Parse mode for message formatting. Default: 'HTML' */
  parseMode?: 'HTML' | 'MarkdownV2'
}

export function telegramAdapter(options: TelegramAdapterOptions): FeedbackAdapter {
  const { botToken, chatId } = options
  const parseMode = options.parseMode ?? 'HTML'
  const apiBase = `https://api.telegram.org/bot${botToken}`

  return {
    name: 'telegram',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      try {
        const detail = event.detail ?? {}
        const message = (detail.message as string) || event.target || 'No message'
        const page = event.page || 'unknown'

        const text = [
          '📝 <b>Feedback</b>',
          '',
          escapeHtml(message),
          '',
          `📍 <code>${escapeHtml(page)}</code>`,
          `🕐 ${event.ts}`,
        ]

        if (detail.user) {
          const user = detail.user as Record<string, unknown>
          const parts = [user.name, user.email].filter(Boolean).map(String)
          if (parts.length) text.push(`👤 ${escapeHtml(parts.join(' — '))}`)
        }

        const caption = text.join('\n')

        if (event.screenshot) {
          const photoBytes = base64ToBlob(event.screenshot, 'image/jpeg')
          const form = new FormData()
          form.append('chat_id', String(chatId))
          form.append('caption', caption)
          form.append('parse_mode', parseMode)
          form.append('photo', photoBytes, 'screenshot.jpg')

          const res = await fetch(`${apiBase}/sendPhoto`, { method: 'POST', body: form })
          if (!res.ok) {
            const err = await res.text()
            return { ok: false, error: `Telegram API ${res.status}: ${err}` }
          }
          const data = (await res.json()) as { result: { message_id: number } }
          return { ok: true, deliveryId: String(data.result.message_id) }
        }

        const res = await fetch(`${apiBase}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: parseMode }),
        })

        if (!res.ok) {
          const err = await res.text()
          return { ok: false, error: `Telegram API ${res.status}: ${err}` }
        }
        const data = (await res.json()) as { result: { message_id: number } }
        return { ok: true, deliveryId: String(data.result.message_id) }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    },
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}
