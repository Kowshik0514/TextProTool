/**
 * Plugin / provider interfaces for extending TextPro.
 * Core stays Electron-free; the desktop app wires concrete implementations.
 */

import type { ActionHandler } from './registry.js'
import type { VariableProvider } from './template.js'

export interface TextProPlugin {
  id: string
  name: string
  version?: string
  /** Optional variable providers contributed by the plugin */
  variables?: VariableProvider[]
  /** Optional action handlers contributed by the plugin */
  handlers?: ActionHandler[]
  activate?(): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export class PluginHost {
  private plugins = new Map<string, TextProPlugin>()

  register(plugin: TextProPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin already registered: ${plugin.id}`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  unregister(id: string): void {
    this.plugins.delete(id)
  }

  get(id: string): TextProPlugin | undefined {
    return this.plugins.get(id)
  }

  list(): TextProPlugin[] {
    return [...this.plugins.values()]
  }

  async activateAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.activate?.()
    }
  }
}
