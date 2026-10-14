import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
})

const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  ki: KEYBDINPUT,
  unionTail: koffi.array('uint8', 8),
})

const MSG = koffi.struct('MSG', {
  hwnd: 'void *',
  message: 'uint32',
  wParam: 'uintptr',
  lParam: 'intptr',
  time: 'uint32',
  pt_x: 'int32',
  pt_y: 'int32',
})

const LowLevelProc = koffi.proto(
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
const PeekMessageW = user32.func(
  'int PeekMessageW(_Out_ MSG *lpMsg, void *hWnd, uint32 min, uint32 max, uint32 remove)',
)
const TranslateMessage = user32.func('int TranslateMessage(MSG *lpMsg)')
const DispatchMessageW = user32.func('intptr DispatchMessageW(MSG *lpMsg)')
const SendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
const ToUnicodeEx = user32.func(
  'int ToUnicodeEx(uint32 vk, uint32 scan, uint8 *state, uint16 *buf, int cch, uint32 flags, void *layout)',
)
const GetKeyboardLayout = user32.func('void *GetKeyboardLayout(uint32 idThread)')
const RtlMoveMemory = kernel32.func('void RtlMoveMemory(_Out_ uint8 *dest, void *src, uintptr length)')

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const PM_REMOVE = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const INPUT_KEYBOARD = 1

const seen = []
let hook = null

function tryDecode(label, fn) {
  try {
    const value = fn()
    console.log(label, JSON.stringify(value))
  } catch (err) {
    console.log(label, 'ERR', err.message)
  }
}

const callback = koffi.register((nCode, wParam, lParam) => {
  if (nCode >= 0 && Number(wParam) === WM_KEYDOWN && seen.length < 3) {
    seen.push('hit')
    tryDecode('decode external', () => koffi.decode(lParam, KBDLLHOOKSTRUCT))
  }
  return CallNextHookEx(hook, nCode, wParam, lParam)
}, koffi.pointer(LowLevelProc))

hook = SetWindowsHookExW(WH_KEYBOARD_LL, callback, null, 0)
if (!hook) {
  console.error('SetWindowsHookEx failed', GetLastError())
  process.exit(1)
}

console.log('sizeof KBDLLHOOKSTRUCT', koffi.sizeof(KBDLLHOOKSTRUCT), '(expected 24)')
console.log('sizeof MSG', koffi.sizeof(MSG))

function pump(ms) {
  const end = Date.now() + ms
  const msg = {}
  while (Date.now() < end) {
    while (PeekMessageW(msg, null, 0, 0, PM_REMOVE)) {
      TranslateMessage(msg)
      DispatchMessageW(msg)
    }
  }
}

const layout = GetKeyboardLayout(0)
const state = Buffer.alloc(256)
state[0x10] = 0x80
state[0xa0] = 0x80
state[0x32] = 0x80
const buf = Buffer.alloc(16)
const n = ToUnicodeEx(0x32, 0, state, buf, 8, 0, layout)
const ch = n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
console.log('shift+2 =>', JSON.stringify(ch), 'n=', n)

const INPUT_SIZE = koffi.sizeof(INPUT)
function key(vk, up) {
  return {
    type: INPUT_KEYBOARD,
    ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 },
    unionTail: [0, 0, 0, 0, 0, 0, 0, 0],
  }
}
SendInput(2, [key(0x87, false), key(0x87, true)], INPUT_SIZE)
pump(300)

UnhookWindowsHookEx(hook)
koffi.unregister(callback)

console.log('hook saw', seen.length, 'key events while idle')
if (ch !== '@' && ch !== '"') {
  console.error('unexpected shift+2 character', JSON.stringify(ch))
  process.exit(1)
}
console.log('keyboard hook install OK')
