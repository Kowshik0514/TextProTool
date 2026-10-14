import { existsSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(root, 'apps', 'desktop')
const mainJs = join(desktopDir, 'out', 'main', 'index.js')

function runNpm(args) {
  const result = spawnSync('npm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(mainJs)) {
  console.log('Building TextPro (first launch)...')
  runNpm(['run', 'build'])
}

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(String(electronPath), ['.'], {
  cwd: desktopDir,
  detached: true,
  stdio: 'ignore',
  env,
  windowsHide: true,
  shell: false,
})

child.on('error', (err) => {
  console.error('Failed to start TextPro:', err.message)
  process.exit(1)
})

child.unref()
console.log('TextPro started — look for the tray icon.')
console.log('Hotkey: Ctrl+Shift+Space')
