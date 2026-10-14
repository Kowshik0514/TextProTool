import type { KeySender } from '@textpro/platform-win'
import { sendBackspaces, sendLeft, sendNamedKey, sendPaste, sendUnicodeText } from './win32'

/**
 * Windows key sender backed by SendInput.
 * Direct injection keeps insertion within a few milliseconds, which matters
 * because a slow sender lets the user's focus move before the keys land.
 */
export function createWindowsKeySender(): KeySender {
  return {
    async paste() {
      sendPaste()
    },
    async typeText(text: string) {
      sendUnicodeText(text)
    },
    async pressKey(name: string) {
      sendNamedKey(name)
    },
  }
}

/**
 * Delete the last N characters (used after abbreviation match to erase the typed trigger).
 */
export async function deleteLastChars(count: number): Promise<void> {
  sendBackspaces(count)
}

/** Move caret left after paste so {{cursor}} can land mid-template. */
export async function moveCaretLeft(count: number): Promise<void> {
  sendLeft(count)
}
