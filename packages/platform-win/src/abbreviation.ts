/**
 * Tracks typed characters and detects abbreviation triggers.
 * Designed to be fed keystrokes from a global keyboard hook in the main process.
 */
export type AbbreviationMatchHandler = (abbreviation: string) => void | Promise<void>

export interface AbbreviationWatcherOptions {
  /** Characters that commit an abbreviation (default: space) */
  delimiters?: string[]
  /** Max buffer length for typed text */
  maxBuffer?: number
  /** Lookup: returns true if abbreviation exists */
  hasAbbreviation: (abbrev: string) => boolean
  onMatch: AbbreviationMatchHandler
}

export class AbbreviationWatcher {
  private buffer = ''
  private readonly delimiters: Set<string>
  private readonly maxBuffer: number
  private readonly hasAbbreviation: (abbrev: string) => boolean
  private readonly onMatch: AbbreviationMatchHandler
  private enabled = true

  constructor(options: AbbreviationWatcherOptions) {
    this.delimiters = new Set(options.delimiters ?? [' ', 'Enter', 'Tab'])
    this.maxBuffer = options.maxBuffer ?? 64
    this.hasAbbreviation = options.hasAbbreviation
    this.onMatch = options.onMatch
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.buffer = ''
  }

  reset(): void {
    this.buffer = ''
  }

  /** Restore the in-progress word after a fast burst was replayed. */
  setBuffer(value: string): void {
    this.buffer = value.slice(-this.maxBuffer)
  }

  /**
   * Feed a printable character or named key ("Backspace", "Enter", " ").
   */
  async handleKey(key: string): Promise<void> {
    if (!this.enabled) return

    if (key === 'Backspace') {
      this.buffer = this.buffer.slice(0, -1)
      return
    }

    if (this.delimiters.has(key) || (key.length === 1 && this.delimiters.has(key))) {
      if (this.buffer && this.hasAbbreviation(this.buffer)) {
        const match = this.buffer
        this.buffer = ''
        await this.onMatch(match)
        return
      }
      this.buffer = ''
      return
    }

    // Only accumulate single printable characters
    if (key.length === 1 && !key.match(/[\x00-\x1f]/)) {
      this.buffer += key
      if (this.buffer.length > this.maxBuffer) {
        this.buffer = this.buffer.slice(-this.maxBuffer)
      }
    } else {
      // Modifier / navigation keys clear the buffer
      if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(key)) {
        this.buffer = ''
      }
    }
  }

  getBuffer(): string {
    return this.buffer
  }
}
