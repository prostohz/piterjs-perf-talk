import { spawn } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// Always instrument the build for coverage and ensure Playwright can launch.
process.env.COVERAGE = 'true'
// Put Playwright browsers inside the project so CI without sudo/system cache still works.
const playwrightCache = process.env.PLAYWRIGHT_BROWSERS_PATH ||
  join(process.cwd(), 'node_modules', '.cache', 'ms-playwright')
process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightCache
const sanitizedEnv = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: playwrightCache }
delete sanitizedEnv.ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RUN_AS_NODE

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false, env: sanitizedEnv, ...opts })
  child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))))
  child.on('error', reject)
})

const runPackageCommand = (cmd, args, opts = {}) => {
  if (process.platform === 'win32') {
    return run(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', cmd, ...args],
      opts
    )
  }

  return run(cmd, args, opts)
}

const runNpm = (args, opts) => runPackageCommand('npm', args, opts)
const runNpx = (args, opts) => runPackageCommand('npx', args, opts)

const hasPlaywright = async () => {
  try {
    await runNpx(['playwright', '--version'], { timeout: 30000 })
    return true
  } catch (error) {
    console.warn('Skipping e2e tests because Playwright is unavailable or failed to verify.')
    console.warn(error.message || error)
    return false
  }
}

const ensureBrowser = async () => {
  // Download Chromium to the project cache if it's missing.
  if (!existsSync(playwrightCache)) {
    await runNpx(['playwright', 'install', 'chromium'])
  }
}

const getLatestMtime = async (root) => {
  let latest = 0
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      const childLatest = await getLatestMtime(fullPath)
      if (childLatest > latest) latest = childLatest
    } else {
      const fileStat = await stat(fullPath)
      if (fileStat.mtimeMs > latest) latest = fileStat.mtimeMs
    }
  }
  return latest
}

const ensureBuild = async () => {
  const distIndex = join(process.cwd(), 'dist', 'editor', 'index.html')
  const distEditor = join(process.cwd(), 'dist', 'editor', 'Editor.js')

  // Check if build exists and has coverage instrumentation
  let needsBuild = !existsSync(distIndex)

  if (!needsBuild && existsSync(distEditor)) {
    // Check if build has coverage instrumentation
    const editorContent = await readFile(distEditor, 'utf-8')
    const hasCoverage = editorContent.includes('__coverage__')
    if (!hasCoverage) {
      console.log('Existing build lacks coverage instrumentation, rebuilding...')
      needsBuild = true
    }
  }

  if (!needsBuild) {
    const distStat = await stat(distIndex)
    const roots = [
      join(process.cwd(), 'packages', 'svgcanvas', 'core'),
      join(process.cwd(), 'src')
    ]
    const latestSource = Math.max(
      ...(await Promise.all(roots.map(getLatestMtime)))
    )
    if (latestSource > distStat.mtimeMs) {
      needsBuild = true
    }
  }

  if (needsBuild) {
    console.log('Building dist/editor for Playwright preview...')
    await runNpm(['run', 'build'])
  }
}

const seedNycFromVitest = async () => {
  const vitestCoverage = join(process.cwd(), 'coverage', 'coverage-final.json')
  if (existsSync(vitestCoverage)) {
    const nycOutputDir = join(process.cwd(), '.nyc_output')
    await mkdir(nycOutputDir, { recursive: true })
    await copyFile(vitestCoverage, join(nycOutputDir, 'vitest.json'))
  }
}

if (await hasPlaywright()) {
  await ensureBrowser()
  await ensureBuild()
  await rm(join(process.cwd(), '.nyc_output'), { recursive: true, force: true })
  await seedNycFromVitest()
  await runNpx(['playwright', 'test'])
  await runNpx(['nyc', 'report', '--reporter', 'text-summary', '--reporter', 'json-summary'])
}
