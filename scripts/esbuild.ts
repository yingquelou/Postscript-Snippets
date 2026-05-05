import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'

interface BuildEnvironment {
  isProduction: boolean
  isWatch: boolean
  nodeTarget: string[]
}

function detectEnvironment(): BuildEnvironment {
  const isWatch = process.argv.includes('--watch')
  const isProduction = process.env.NODE_ENV === 'production' || !isWatch

  return {
    isProduction,
    isWatch,
    nodeTarget: ['node16']
  }
}

function createBuildOptions(env: BuildEnvironment): esbuild.BuildOptions {
  return {
    entryPoints: [
      'src/extension.ts',
      'src/language-server/languageServer.ts',
      'src/debugger/debugAdapter.ts',
    ],
    bundle: true,
    platform: 'node',
    target: env.nodeTarget,
    outdir: 'out',
    outbase: 'src',
    sourcemap: env.isProduction ? false : 'linked',
    write: true,
    
    // 生产环境完整压缩优化
    minify: env.isProduction,
    minifyIdentifiers: env.isProduction,
    minifySyntax: env.isProduction,
    minifyWhitespace: env.isProduction,
    
    tsconfig: 'src/tsconfig.json',
    external: ['vscode'],
    logLevel: env.isWatch ? 'info' : 'warning',
    metafile: env.isProduction,
    legalComments: env.isProduction ? 'none' : 'inline',
    
    // 生产环境移除调试代码
    drop: env.isProduction ? ['debugger', 'console'] : [],
    
    treeShaking: env.isProduction,
    keepNames: !env.isProduction,
    charset: 'utf8',
    allowOverwrite: true,
    resolveExtensions: ['.ts', '.js', '.json'],
    logLimit: 0,
    color: true,
    ignoreAnnotations: env.isProduction,
    
    // 仅生产环境启用属性混淆
    mangleProps: env.isProduction ? /^_/ : undefined,
    mangleQuoted: false,
    
    pure: env.isProduction ? ['console.debug', 'console.trace', 'console.info'] : [],
    dropLabels: env.isProduction ? ['DEBUG', 'DEV'] : [],
    
    format: 'cjs',
    assetNames: '[name]',
  }
}

function printBuildStats(metafile: esbuild.Metafile) {
  console.log('');
  console.log('=== Build Statistics ===');

  let totalSize = 0;
  const outputs = Object.entries(metafile.outputs);

  outputs.forEach(([path, output]) => {
    const sizeKB = (output.bytes / 1024).toFixed(2);
    totalSize += output.bytes;
    console.log('  ' + path + ': ' + sizeKB + ' KB');
  });

  console.log('');
  console.log('Total output size: ' + (totalSize / 1024).toFixed(2) + ' KB');
  console.log('Number of outputs: ' + outputs.length);
  console.log('========================');
  console.log('');
}

function handleSignals(ctx: Awaited<ReturnType<typeof esbuild.context>>) {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log('');
      console.log('Received ' + signal + ', stopping watch mode exiting gracefully...');
      await ctx.dispose();
      console.log('Build context disposed successfully');
      process.exit(0);
    });
  });
}

async function run() {
  const startTime = performance.now();
  const env = detectEnvironment();

  console.log('Starting ' + (env.isProduction ? 'PRODUCTION' : 'DEVELOPMENT') + ' build');
  console.log('Mode: ' + (env.isWatch ? 'WATCH' : 'ONESHOT'));

  try {
    const buildOptions = createBuildOptions(env);

    if (env.isWatch) {
      const ctx = await esbuild.context(buildOptions);
      handleSignals(ctx);

      console.log('');
      console.log('Watching for changes...');
      console.log('Press Ctrl+C to exit');
      console.log('');

      await ctx.watch();
    } else {
      const result = await esbuild.build(buildOptions);

      const buildTime = (performance.now() - startTime).toFixed(0);
      console.log('');
      console.log('Build completed in ' + buildTime + 'ms');

      if (result.metafile) {
        printBuildStats(result.metafile);
      }

      process.exit(0);
    }
  } catch (error) {
    console.error('');
    console.error('Build failed:');
    console.error(error);
    process.exit(1);
  }
}

run();