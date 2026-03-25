import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SNAPFEED_STYLE_PRESET,
  getSnapfeedStylePreset,
  getSnapfeedTheme,
  resolveSnapfeedTheme,
  setSnapfeedStylePreset,
  setSnapfeedTheme,
} from './ui-theme.js'

describe('ui theme', () => {
  it('resolves preset names without changing tokens', () => {
    const resolvedTheme = resolveSnapfeedTheme('nord')

    expect(resolvedTheme.preset).toBe('nord')
    expect(resolvedTheme.theme.accent).toBe('#88c0d0')
  })

  it('merges custom tokens over the default preset', () => {
    const resolvedTheme = resolveSnapfeedTheme({
      accent: '#0f6cbd',
      panelBackground: '#ffffff',
    })

    expect(resolvedTheme.preset).toBeNull()
    expect(resolvedTheme.theme.accent).toBe('#0f6cbd')
    expect(resolvedTheme.theme.panelBackground).toBe('#ffffff')
    expect(resolvedTheme.theme.panelText).toBe('#cdd6f4')
  })

  it('tracks custom theme state separately from preset state', () => {
    setSnapfeedStylePreset('terminal')
    expect(getSnapfeedStylePreset()).toBe('terminal')

    setSnapfeedTheme({ accent: '#0f6cbd' })

    expect(getSnapfeedStylePreset()).toBeNull()
    expect(getSnapfeedTheme().accent).toBe('#0f6cbd')

    setSnapfeedStylePreset(DEFAULT_SNAPFEED_STYLE_PRESET)
  })
})
