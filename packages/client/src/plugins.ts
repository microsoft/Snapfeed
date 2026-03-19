/**
 * Plugin manager — register/unregister framework plugins and call enrichElement.
 */

import type { SnapfeedPlugin, ElementEnrichment } from './types.js'

const plugins = new Map<string, SnapfeedPlugin>()

/** Register a framework plugin (e.g. React, Angular). */
export function registerPlugin(plugin: SnapfeedPlugin): void {
  if (plugins.has(plugin.name)) {
    console.warn(`[snapfeed] Plugin "${plugin.name}" already registered, replacing.`)
    const existing = plugins.get(plugin.name)!
    existing.onDestroy?.()
  }
  plugins.set(plugin.name, plugin)
  plugin.onInit?.()
}

/** Unregister a plugin by name. */
export function unregisterPlugin(name: string): void {
  const plugin = plugins.get(name)
  if (plugin) {
    plugin.onDestroy?.()
    plugins.delete(name)
  }
}

/** Get all registered plugin names. */
export function getPluginNames(): string[] {
  return Array.from(plugins.keys())
}

/**
 * Call all registered plugins to enrich a DOM element.
 * Returns merged enrichment from all plugins, or null if none provide data.
 */
export function enrichElement(el: Element): ElementEnrichment | null {
  let merged: ElementEnrichment | null = null
  for (const plugin of plugins.values()) {
    try {
      const enrichment = plugin.enrichElement(el)
      if (enrichment) {
        if (!merged) merged = {}
        Object.assign(merged, enrichment)
      }
    } catch {
      // Plugins should not break telemetry
    }
  }
  return merged
}

/** Clear all plugins (used in teardown). */
export function clearPlugins(): void {
  for (const plugin of plugins.values()) {
    plugin.onDestroy?.()
  }
  plugins.clear()
}
