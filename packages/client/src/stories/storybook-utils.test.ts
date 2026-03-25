import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../types.js'
import { getSnapfeedStylePreset, setSnapfeedStylePreset } from '../ui-theme.js'
import { configureFeedbackStory } from './storybook-utils.js'

describe('configureFeedbackStory', () => {
  it('keeps the requested preset after feedback initialization', () => {
    setSnapfeedStylePreset('modern')

    configureFeedbackStory('nord', resolveConfig({}))

    expect(getSnapfeedStylePreset()).toBe('nord')
  })
})
