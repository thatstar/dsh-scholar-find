// Produce a ready-to-install build of this plugin in one folder:
//
//   dist/dsh-scholar-find/            ← install straight from this directory
//   dist/dsh-scholar-find-<ver>.tgz   ← or from this tarball
//
// Why a separate artifact: pnpm only runs a package's build script for *git*
// specs (git-fetcher -> prepare-package/lib/index.js). Registry, tarball and
// path specs are installed as-is, so a machine whose Node lives inside an app
// bundle (DSH desktop on Windows) can install this folder without ever
// compiling anything. `lib/` is therefore copied in already built, and the
// staged manifest deliberately drops `prepare`, so no install path — not even a
// git URL pointing at the staged folder — can trigger a build there.
//
// Usage: node scripts/pack-dist.mjs [--out <dir>] [--no-build] [--no-tgz]
import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const NAME = pkg.name
/** Everything the installed plugin needs; `package.json` is written separately. */
const STAGED_ENTRIES = ['cordis.patch.yml', 'lib', 'LICENSE']

/** The manifest a consumer must see: everything publishable, minus any build. */
export function stageManifest(manifest) {
  const staged = structuredClone(manifest)
  if (staged.scripts) {
    delete staged.scripts.prepare
    if (Object.keys(staged.scripts).length === 0) delete staged.scripts
  }
  return staged
}

function run(command, args, cwd, { shell = false, capture = false } = {}) {
  // With shell: true (how .cmd shims are spawned on Windows) Node joins the
  // arguments verbatim, so quote the ones that carry spaces.
  const effectiveArgs = shell ? args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)) : args
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, effectiveArgs, {
      cwd,
      shell,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    })
    let stdout = ''
    if (capture) child.stdout.on('data', (chunk) => (stdout += chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(stdout)
        : reject(new Error(`${command} ${args[0] ?? ''} exited with ${code}`)),
    )
  })
}

function parseArgs(argv) {
  const options = { out: 'dist', build: true, tgz: true, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') options.out = argv[++i] ?? options.out
    else if (arg === '--no-build') options.build = false
    else if (arg === '--no-tgz') options.tgz = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  return options
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function packDist({ out = 'dist', build = true, tgz = true } = {}) {
  const outDir = resolve(root, out)

  if (build) {
    // Run the compilers through this Node process instead of their
    // node_modules/.bin shims, so the build does not depend on PATH either.
    console.log('[pack-dist] tsc -p tsconfig.json')
    await run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], root)
    console.log('[pack-dist] scripts/build-client.mjs')
    await run(process.execPath, [join(root, 'scripts', 'build-client.mjs')], root)
  }

  const stagedDir = join(outDir, NAME)
  await rm(stagedDir, { recursive: true, force: true })
  await mkdir(stagedDir, { recursive: true })
  await writeFile(join(stagedDir, 'package.json'), `${JSON.stringify(stageManifest(pkg), null, 2)}\n`)
  for (const entry of STAGED_ENTRIES) {
    if (await exists(join(root, entry))) {
      await cp(join(root, entry), join(stagedDir, entry), { recursive: true })
    }
  }

  // The staged tree is what gets installed, so prove its entry points are real.
  for (const required of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
    await readFile(join(stagedDir, required))
  }

  let tarball
  if (tgz) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    try {
      const printed = await run(
        npm,
        ['pack', '--ignore-scripts', '--pack-destination', outDir],
        stagedDir,
        { shell: process.platform === 'win32', capture: true },
      )
      process.stdout.write(printed)
      const filename = printed.split('\n').map((line) => line.trim()).filter(Boolean).pop()
      if (filename) tarball = join(outDir, filename.replace(/^.*[\\/]/, ''))
    } catch (error) {
      console.warn(`[pack-dist] skipped the tarball: ${String(error)}`)
    }
  }

  return { outDir, stagedDir, tarball }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('usage: node scripts/pack-dist.mjs [--out <dir>] [--no-build] [--no-tgz]')
  } else {
    const { stagedDir, tarball } = await packDist(options)
    console.log('\n[pack-dist] ready — installing these runs no build on the target machine:\n')
    console.log(`  dsh plugin --profile web add ${stagedDir}`)
    if (tarball) console.log(`  dsh plugin --profile web add ${tarball}`)
  }
}
