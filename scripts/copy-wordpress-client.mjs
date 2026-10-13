import { copyFileSync } from 'node:fs'

copyFileSync(
  new URL('../packages/client/dist/snapfeed.global.js', import.meta.url),
  new URL('../packages/wordpress/assets/js/snapfeed.global.js', import.meta.url),
)
