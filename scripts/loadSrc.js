/* eslint-disable */
// Load a TypeScript source module from a verification script.
//
// Why not `require('../out/…')`: `npm run package` starts with `prepackage`
// → `clean:out`, which leaves out/ holding only the two esbuild bundles. A
// verifier that requires tsc emit therefore passes or explodes depending on
// which command ran last (reproduced: `npm run package` followed by
// `npm run verify:parity` → MODULE_NOT_FOUND on out/language-server).
// Bundling the entry straight from source with esbuild makes the verification
// scripts independent of build order and of out/ contents.
const path = require('path')
const fs = require('fs')
const os = require('os')

const root = path.join(__dirname, '..')
const loaded = new Map()
let outDir

function loadSrc(relativePath) {
  const cached = loaded.get(relativePath)
  if (cached) return cached

  // resolved lazily: esbuild is a devDependency, so a missing install should
  // read as "run npm install" instead of failing at require time
  const esbuild = require('esbuild')

  if (!outDir) {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-verify-'))
    process.on('exit', () => {
      try {
        fs.rmSync(outDir, { recursive: true, force: true })
      } catch {
        // best effort
      }
    })
  }

  const outfile = path.join(outDir, relativePath.replace(/[\\/]/g, '_').replace(/\.ts$/, '.cjs'))
  esbuild.buildSync({
    entryPoints: [path.join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent'
  })

  const mod = require(outfile)
  loaded.set(relativePath, mod)
  return mod
}

module.exports = { loadSrc }
