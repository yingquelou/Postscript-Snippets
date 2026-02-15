import * as esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')

const buildOptions: esbuild.BuildOptions = {
  entryPoints: [
    'src/extension.ts',
    'src/server.ts',
    'src/debugAdapter.ts',
  ],
  bundle: true,
  platform: 'node',
  target: ['node16'],
  format: 'cjs',
  outdir: 'dist',
  outbase: 'src',
  sourcemap: true,
  minify: true,
  tsconfig: 'tsconfig.json',
  external: ['vscode'],
  logLevel: 'info',
}

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions)
    await ctx.watch()
  } else {
    await esbuild.build(buildOptions)
  }
}

run().catch(() => process.exit(1))
