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

const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  ki: KEYBDINPUT,
  unionTail: koffi.array('uint8', 8),
})

user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
const GetForegroundWindow = user32.func('void* GetForegroundWindow()')
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(void* hWnd, _Out_ uint32 *lpdwProcessId)',
)
const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()')

console.log('sizeof(KEYBDINPUT) =', koffi.sizeof(KEYBDINPUT), '(expected 24)')
console.log('sizeof(INPUT)      =', koffi.sizeof(INPUT), '(expected 40)')

const hwnd = GetForegroundWindow()
const out = [0]
const tid = GetWindowThreadProcessId(hwnd, out)
console.log('foreground thread  =', tid, 'pid =', out[0])
console.log('current thread     =', GetCurrentThreadId())

if (koffi.sizeof(INPUT) !== 40) {
  console.error('INPUT layout mismatch')
  process.exit(1)
}
console.log('win32 bindings OK')
