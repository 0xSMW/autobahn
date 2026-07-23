#!/usr/bin/env node
// npx github:0xSMW/autobahn [dir] [--domain[=name]] [--port N]  → serve once
// npx github:0xSMW/autobahn setup [dir]                         → resident install
//
// setup: clones the app to ~/.autobahn, installs portless (the local
// HTTPS proxy that gives it https://autobahn.localhost), and on macOS
// registers a LaunchAgent so the board is always on, rooted at [dir]
// (default: the current directory). Re-run any time to update.
import path from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

if (process.argv[2] !== 'setup') {
  await import('./server.mjs') // serve: argv shape is exactly what server.mjs reads
} else {
  const HOME = homedir()
  const APP = path.join(HOME, '.autobahn')
  const ROOT = path.resolve(process.argv[3] || '.')
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
  const out = (cmd, args) => execFileSync(cmd, args).toString().trim()

  if (existsSync(path.join(APP, '.git'))) run('git', ['-C', APP, 'pull', '--ff-only'])
  else run('git', ['clone', '--depth', '1', 'https://github.com/0xSMW/autobahn', APP])

  let portless = null
  try { portless = out('which', ['portless']) } catch { /* not installed yet */ }
  if (!portless) { run('npm', ['install', '--global', 'portless']); portless = out('which', ['portless']) }
  try { run(portless, ['service', 'install']) } catch { /* proxy service already installed */ }

  if (process.platform === 'darwin') {
    const label = 'com.autobahn.board'
    const log = path.join(HOME, 'Library/Logs/autobahn.log')
    const dest = path.join(HOME, 'Library/LaunchAgents', label + '.plist')
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${portless}</string><string>autobahn</string>
    <string>${process.execPath}</string><string>--watch</string>
    <string>${path.join(APP, 'server.mjs')}</string><string>${ROOT}</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`)
    const gui = 'gui/' + process.getuid()
    try { run('launchctl', ['bootout', gui + '/' + label]) } catch { /* first install */ }
    run('launchctl', ['bootstrap', gui, dest])
    console.log(`\nAutobahn → https://autobahn.localhost  (root: ${ROOT})`)
    console.log(`app: ${APP} · log: ${log} · re-run setup to update`)
  } else {
    console.log(`\nNo service manager wired for ${process.platform} — run it with:`)
    console.log(`  ${portless} autobahn ${process.execPath} --watch ${path.join(APP, 'server.mjs')} ${ROOT}`)
  }
}
