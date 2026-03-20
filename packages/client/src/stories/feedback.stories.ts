import type { Meta, StoryObj } from '@storybook/html'
import { resolveConfig } from '../types.js'
import {
  configureFeedbackStory,
  createFixtureCard,
  openFeedbackForFixture,
  renderStoryShell,
  type StoryPreset,
} from './storybook-utils.js'

const meta = {
  title: 'Snapfeed/Feedback Overlay',
} satisfies Meta

export default meta

type Story = StoryObj

function renderFeedbackPreset(
  preset: StoryPreset,
  title: string,
  subtitle: string,
): HTMLDivElement {
  let hasAutoOpened = false
  const root = renderStoryShell(title, subtitle)
  const fixture = createFixtureCard()
  root.appendChild(fixture)

  configureFeedbackStory(
    preset,
    resolveConfig({
      feedback: {
        enabled: true,
        annotations: true,
        screenshotQuality: 0.8,
        allowScreenshotToggle: true,
        allowContextToggle: true,
        defaultIncludeScreenshot: true,
        defaultIncludeContext: true,
      },
      captureConsoleErrors: false,
      trackApiErrors: false,
      trackClicks: false,
      trackErrors: false,
      trackNavigation: false,
      user: {
        name: 'Storybook Preview',
        email: 'preview@snapfeed.dev',
      },
    }),
  )

  const target = fixture.querySelector('#feedback-target')
  if (target) {
    target.addEventListener('click', () => openFeedbackForFixture(target))

    requestAnimationFrame(() => {
      if (hasAutoOpened) {
        return
      }
      hasAutoOpened = true
      openFeedbackForFixture(target)
    })
  }

  return root
}

export const Modern: Story = {
  render: () =>
    renderFeedbackPreset(
      'modern',
      'Modern feedback overlay',
      'A clean default treatment that keeps the current Snapfeed feel but exposes it as a visual surface you can tune.',
    ),
}

export const Windows90s: Story = {
  render: () =>
    renderFeedbackPreset(
      'windows90s',
      'Windows 90s feedback overlay',
      'Classic desktop chrome with hard edges, system-font density, and high-contrast framing so you can judge whether the interaction benefits from a more literal operating-system feel.',
    ),
}

export const Terminal: Story = {
  render: () =>
    renderFeedbackPreset(
      'terminal',
      'Terminal feedback overlay',
      'A utilitarian preset that shows how the same interaction reads with monospaced typography and flatter chrome.',
    ),
}

export const GitHubLight: Story = {
  render: () =>
    renderFeedbackPreset(
      'githubLight',
      'GitHub Light feedback overlay',
      'A familiar light preset with restrained borders and clearer daylight contrast for teams that prefer product UI chrome over modal-heavy dark surfaces.',
    ),
}

export const Dracula: Story = {
  render: () =>
    renderFeedbackPreset(
      'dracula',
      'Dracula feedback overlay',
      'A high-recognition editor-inspired preset with saturated accent treatment, useful for checking whether stronger emphasis improves action hierarchy.',
    ),
}

export const Nord: Story = {
  render: () =>
    renderFeedbackPreset(
      'nord',
      'Nord feedback overlay',
      'A cooler slate preset that keeps the interface subdued while preserving clearer structure than the terminal treatment.',
    ),
}
