import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

// Win64 INPUT is 40 bytes: type + padding + the largest union member (MOUSEINPUT).
// KEYBDINPUT only fills 24 of those 32 union bytes, so the tail is padded explicitly.
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  ki: KEYBDINPUT,
  unionTail: koffi.array('uint8', 8),
})

const SendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
const GetAsyncKeyStateFn = user32.func('int16 GetAsyncKeyState(int vk)')
const GetKeyStateFn = user32.func('int16 GetKeyState(int vk)')
const GetForegroundWindowFn = user32.func('void* GetForegroundWindow()')
const SetForegroundWindowFn = user32.func('int SetForegroundWindow(void* hWnd)')
const BringWindowToTop = user32.func('int BringWindowToTop(void* hWnd)')
const IsWindow = user32.func('int IsWindow(void* hWnd)')
const AttachThreadInput = user32.func(
  'int AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)',
)
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(void* hWnd, _Out_ uint32 *lpdwProcessId)',
)
const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()')

const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004

const VK_BACK = 0x08
const VK_RETURN = 0x0d
const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_V = 0x56

const INPUT_SIZE = koffi.sizeof(INPUT)

export type WindowHandle = unknown

type KeyInput = {
  type: number
  ki: {
    wVk: number
    wScan: number
    dwFlags: number
    time: number
    dwExtraInfo: number
  }
  unionTail: number[]
}

function keyInput(wVk: number, wScan: number, dwFlags: number): KeyInput {
  return {
    type: INPUT_KEYBOARD,
    ki: { wVk, wScan, dwFlags, time: 0, dwExtraInfo: 0 },
    unionTail: [0, 0, 0, 0, 0, 0, 0, 0],
  }
}

function send(inputs: KeyInput[]): void {
  if (inputs.length === 0) return
  SendInput(inputs.length, inputs, INPUT_SIZE)
}

function vkPress(vk: number): KeyInput {
  return keyInput(vk, 0, 0)
}

function vkRelease(vk: number): KeyInput {
  return keyInput(vk, 0, KEYEVENTF_KEYUP)
}

export function isKeyDown(vk: number): boolean {
  return (GetAsyncKeyStateFn(vk) & 0x8000) !== 0
}

/**
 * True if the key was pressed since the previous call for this vk.
 * The low bit survives presses shorter than the polling interval, so fast
 * typing is not dropped the way high-bit sampling drops it.
 */
export function wasKeyPressed(vk: number): boolean {
  return (GetAsyncKeyStateFn(vk) & 0x0001) !== 0
}

/** Release any modifier the user may still be holding from a hotkey. */
function releaseModifiers(): void {
  send([
    vkRelease(VK_SHIFT),
    vkRelease(VK_CONTROL),
    vkRelease(VK_MENU),
    vkRelease(VK_LWIN),
    vkRelease(VK_RWIN),
  ])
}

export function sendPaste(): void {
  releaseModifiers()
  send([vkPress(VK_CONTROL), vkPress(VK_V), vkRelease(VK_V), vkRelease(VK_CONTROL)])
}

export function sendBackspaces(count: number): void {
  if (count <= 0) return
  const inputs: KeyInput[] = []
  for (let i = 0; i < count; i++) {
    inputs.push(vkPress(VK_BACK), vkRelease(VK_BACK))
  }
  send(inputs)
}

const NAMED_VKS: Record<string, number> = {
  enter: VK_RETURN,
  tab: 0x09,
  escape: 0x1b,
  backspace: VK_BACK,
  space: 0x20,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  delete: 0x2e,
}

export function sendNamedKey(name: string): void {
  const vk = NAMED_VKS[name.toLowerCase()]
  if (vk === undefined) {
    throw new Error(`Unsupported key: ${name}`)
  }
  releaseModifiers()
  send([vkPress(vk), vkRelease(vk)])
}

/** Move the caret left by `count` characters (after a paste lands at the end). */
export function sendLeft(count: number): void {
  if (count <= 0) return
  const vk = NAMED_VKS.left
  const inputs: KeyInput[] = []
  for (let i = 0; i < count; i++) {
    inputs.push(vkPress(vk), vkRelease(vk))
  }
  releaseModifiers()
  for (let i = 0; i < inputs.length; i += 200) {
    send(inputs.slice(i, i + 200))
  }
}

/**
 * Type text as Unicode input so it works regardless of keyboard layout.
 */
export function sendUnicodeText(text: string): void {
  releaseModifiers()
  const inputs: KeyInput[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x0d) continue
    if (code === 0x0a) {
      inputs.push(vkPress(VK_RETURN), vkRelease(VK_RETURN))
      continue
    }
    inputs.push(
      keyInput(0, code, KEYEVENTF_UNICODE),
      keyInput(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
    )
  }
  // SendInput has a practical batch limit; chunk to stay well below it.
  for (let i = 0; i < inputs.length; i += 200) {
    send(inputs.slice(i, i + 200))
  }
}

export function getForegroundWindow(): { handle: WindowHandle; pid: number } | null {
  const handle = GetForegroundWindowFn()
  if (!handle) return null
  const out: number[] = [0]
  GetWindowThreadProcessId(handle, out)
  return { handle, pid: out[0] }
}

/**
 * Give focus back to a previously captured window.
 * AttachThreadInput lifts the foreground lock without the Alt-tap trick,
 * which would otherwise open menu bars in apps like Chrome.
 */
export function focusWindow(handle: WindowHandle): boolean {
  if (!handle || !IsWindow(handle)) return false

  const out: number[] = [0]
  const targetThread = GetWindowThreadProcessId(handle, out)
  const currentThread = GetCurrentThreadId()

  let attached = false
  if (targetThread !== currentThread) {
    attached = AttachThreadInput(currentThread, targetThread, 1) !== 0
  }

  const ok = SetForegroundWindowFn(handle) !== 0
  BringWindowToTop(handle)

  if (attached) {
    AttachThreadInput(currentThread, targetThread, 0)
  }

  return ok
}

export const MODIFIER_VKS = {
  control: VK_CONTROL,
  alt: VK_MENU,
  lwin: VK_LWIN,
  rwin: VK_RWIN,
}

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

const LowLevelKeyboardProc = koffi.proto(
  'intptr __stdcall LowLevelKeyboardProc(int nCode, uintptr wParam, KBDLLHOOKSTRUCT *lParam)',
)

const SetWindowsHookExW = user32.func(
  'void *SetWindowsHookExW(int idHook, LowLevelKeyboardProc *lpfn, void *hMod, uint32 dwThreadId)',
)
const CallNextHookEx = user32.func(
  'intptr CallNextHookEx(void *hhk, int nCode, uintptr wParam, KBDLLHOOKSTRUCT *lParam)',
)
const UnhookWindowsHookEx = user32.func('int UnhookWindowsHookEx(void *hhk)')
const GetLastError = kernel32.func('uint32 GetLastError()')
const ToUnicodeEx = user32.func(
  'int ToUnicodeEx(uint32 vk, uint32 scan, uint8 *state, uint16 *buf, int cch, uint32 flags, void *layout)',
)
const GetKeyboardLayout = user32.func('void *GetKeyboardLayout(uint32 idThread)')

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const WM_SYSKEYDOWN = 0x0104
const LLKHF_UP = 0x80
const LLKHF_INJECTED = 0x10
const LLKHF_LOWER_IL_INJECTED = 0x02
const VK_CAPITAL = 0x14
const VK_NUMLOCK = 0x90
const VK_LSHIFT = 0xa0
const VK_RSHIFT = 0xa1

const BASE_CHAR: Record<number, string> = {
  0x30: '0',
  0x31: '1',
  0x32: '2',
  0x33: '3',
  0x34: '4',
  0x35: '5',
  0x36: '6',
  0x37: '7',
  0x38: '8',
  0x39: '9',
  0xba: ';',
  0xbb: '=',
  0xbc: ',',
  0xbd: '-',
  0xbe: '.',
  0xbf: '/',
  0xc0: '`',
  0xdb: '[',
  0xdc: '\\',
  0xdd: ']',
  0xde: "'",
}

const SHIFT_CHAR: Record<number, string> = {
  0x30: ')',
  0x31: '!',
  0x32: '@',
  0x33: '#',
  0x34: '$',
  0x35: '%',
  0x36: '^',
  0x37: '&',
  0x38: '*',
  0x39: '(',
  0xba: ':',
  0xbb: '+',
  0xbc: '<',
  0xbd: '_',
  0xbe: '>',
  0xbf: '?',
  0xc0: '~',
  0xdb: '{',
  0xdc: '|',
  0xdd: '}',
  0xde: '"',
}

export type KeyboardHookEvent =
  | { kind: 'char'; text: string }
  | { kind: 'nav' }
  | { kind: 'shortcut' }
  | { kind: 'ignore' }

function toggled(vk: number): boolean {
  return (GetKeyStateFn(vk) & 1) !== 0
}

function shiftDown(): boolean {
  return isKeyDown(VK_SHIFT) || isKeyDown(VK_LSHIFT) || isKeyDown(VK_RSHIFT)
}

function mapCharacter(vk: number): string | null {
  const shift = shiftDown()
  if (vk >= 0x41 && vk <= 0x5a) {
    const lower = String.fromCharCode(vk + 32)
    const upper = shift !== capsLockOn
    return upper ? lower.toUpperCase() : lower
  }
  if (vk >= 0x60 && vk <= 0x69) {
    return numLockOn ? String(vk - 0x60) : null
  }
  if (shift && SHIFT_CHAR[vk]) return SHIFT_CHAR[vk]
  return BASE_CHAR[vk] ?? null
}

function unicodeCharacter(vk: number, scan: number): string | null {
  const state = Buffer.alloc(256)
  if (shiftDown()) {
    state[VK_SHIFT] = 0x80
    state[VK_LSHIFT] = 0x80
  }
  if (capsLockOn) state[VK_CAPITAL] = 0x01
  if (isKeyDown(VK_CONTROL) && isKeyDown(VK_MENU)) {
    state[VK_CONTROL] = 0x80
    state[VK_MENU] = 0x80
  }
  state[vk] = 0x80

  const hwnd = GetForegroundWindowFn()
  let layout: unknown = null
  if (hwnd) {
    const pid = [0]
    const threadId = GetWindowThreadProcessId(hwnd, pid)
    layout = GetKeyboardLayout(threadId)
  }
  if (!layout) layout = GetKeyboardLayout(0)

  const buf = Buffer.alloc(16)
  const n = ToUnicodeEx(vk, scan, state, buf, 8, 0, layout) as number
  if (n <= 0) return null
  const text = buf.toString('utf16le', 0, n * 2)
  if (!text || /[\u0000-\u001f]/.test(text)) return null
  return text
}

function describeKey(vk: number, scan: number): KeyboardHookEvent {
  if (
    vk === VK_SHIFT ||
    vk === VK_CONTROL ||
    vk === VK_MENU ||
    vk === VK_LWIN ||
    vk === VK_RWIN ||
    vk === VK_LSHIFT ||
    vk === VK_RSHIFT ||
    vk === 0xa2 ||
    vk === 0xa3 ||
    vk === 0xa4 ||
    vk === 0xa5 ||
    vk === VK_CAPITAL ||
    vk === VK_NUMLOCK
  ) {
    if (vk === VK_CAPITAL) capsLockOn = !capsLockOn
    if (vk === VK_NUMLOCK) numLockOn = !numLockOn
    return { kind: 'ignore' }
  }

  const win = isKeyDown(VK_LWIN) || isKeyDown(VK_RWIN)
  const ctrl = isKeyDown(VK_CONTROL)
  const alt = isKeyDown(VK_MENU)
  if (win || (ctrl && !alt) || (alt && !ctrl)) return { kind: 'shortcut' }

  if (vk === VK_BACK) return { kind: 'char', text: 'Backspace' }
  if (vk === VK_RETURN) return { kind: 'char', text: 'Enter' }
  if (vk === 0x09) return { kind: 'char', text: 'Tab' }
  if (vk === 0x20) return { kind: 'char', text: ' ' }
  if (vk === 0x1b || vk === 0x2e || (vk >= 0x21 && vk <= 0x28) || (vk >= 0x70 && vk <= 0x87)) {
    return { kind: 'nav' }
  }
  if (vk >= 0x60 && vk <= 0x69 && !numLockOn) return { kind: 'nav' }

  const mapped = mapCharacter(vk) ?? unicodeCharacter(vk, scan)
  if (!mapped) return { kind: 'ignore' }
  return { kind: 'char', text: mapped }
}

let hookHandle: unknown = null
let hookCallback: ReturnType<typeof koffi.register> | null = null
let hookInstalled = false
let insideHook = false
let capsLockOn = false
let numLockOn = true

/**
 * Low-level keyboard hook. Events arrive in the order the keys were pressed,
 * which polling cannot guarantee when several keys land in one sample.
 * The listener returns true to swallow the key.
 */
export function installKeyboardHook(onKey: (event: KeyboardHookEvent) => boolean): () => void {
  if (hookHandle) return uninstallKeyboardHook

  capsLockOn = toggled(VK_CAPITAL)
  numLockOn = toggled(VK_NUMLOCK)

  hookCallback = koffi.register((nCode: number, wParam: unknown, lParam: unknown) => {
    let locked = false
    try {
      if (!hookInstalled || insideHook || nCode < 0) {
        return CallNextHookEx(hookHandle, nCode, wParam, lParam)
      }
      const message = Number(wParam)
      if (message !== WM_KEYDOWN && message !== WM_SYSKEYDOWN) {
        return CallNextHookEx(hookHandle, nCode, wParam, lParam)
      }
      const info = koffi.decode(lParam, KBDLLHOOKSTRUCT) as {
        vkCode: number
        scanCode: number
        flags: number
      }
      if (info.flags & LLKHF_UP) {
        return CallNextHookEx(hookHandle, nCode, wParam, lParam)
      }
      if (info.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) {
        return CallNextHookEx(hookHandle, nCode, wParam, lParam)
      }

      insideHook = true
      locked = true
      const event = describeKey(info.vkCode, info.scanCode)
      const swallow = onKey(event)
      if (swallow) return 1
      return CallNextHookEx(hookHandle, nCode, wParam, lParam)
    } catch (err) {
      console.error('TextPro keyboard hook error:', err)
      try {
        return CallNextHookEx(hookHandle, nCode, wParam, lParam)
      } catch {
        return 0
      }
    } finally {
      if (locked) insideHook = false
    }
  }, koffi.pointer(LowLevelKeyboardProc))

  hookHandle = SetWindowsHookExW(WH_KEYBOARD_LL, hookCallback, null, 0)
  if (!hookHandle) {
    const code = GetLastError()
    const callback = hookCallback
    hookCallback = null
    if (callback) koffi.unregister(callback)
    throw new Error(`SetWindowsHookExW failed (${code})`)
  }
  hookInstalled = true
  return uninstallKeyboardHook
}

function uninstallKeyboardHook(): void {
  hookInstalled = false
  if (hookHandle) {
    UnhookWindowsHookEx(hookHandle)
    hookHandle = null
  }
  if (hookCallback) {
    koffi.unregister(hookCallback)
    hookCallback = null
  }
}
