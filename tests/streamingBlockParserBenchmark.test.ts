import { StreamingBlockParser, Block } from '@/debugger/StreamingBlockParser';

// 生成测试数据
function generateTestData(numBlocks: number, nestingDepth: number): string {
  let data = 'free_start_';
  let currentId = 0;

  function addNestedBlock(depth: number) {
    if (depth > nestingDepth) return;
    const id = currentId++;
    data += `OUTER(${id})_content_before_`;
    if (depth < nestingDepth) {
      for (let i = 0; i < 3; i++) {
        addNestedBlock(depth + 1);
      }
    }
    data += `_content_after_END_OUTER(${id})_`;
  }

  for (let i = 0; i < numBlocks; i++) {
    addNestedBlock(0);
  }
  data += 'free_end';
  return data;
}

// 运行基准测试
function runBenchmark() {
  console.log('=== StreamingBlockParser 性能基准测试 ===\n');

  const defs = [
    { name: 'outer', startTemplate: 'OUTER({id})', endTemplate: 'END_OUTER({id})' },
    { name: 'inner', startTemplate: 'INNER({id})', endTemplate: 'END_INNER({id})' }
  ];

  // 测试配置
  const testCases = [
    { name: '小数据 (10 blocks)', numBlocks: 10, nestingDepth: 1, iterations: 100 },
    { name: '中等数据 (100 blocks)', numBlocks: 100, nestingDepth: 2, iterations: 50 },
    { name: '大数据 (1000 blocks)', numBlocks: 1000, nestingDepth: 2, iterations: 10 }
  ];

  for (const test of testCases) {
    console.log(`测试: ${test.name}`);
    console.log('----------------------------------------');

    const testData = generateTestData(test.numBlocks, test.nestingDepth);
    let totalTime = 0;

    for (let i = 0; i < test.iterations; i++) {
      const parser = new StreamingBlockParser(defs);
      const startTime = performance.now();
      parser.write(testData);

      // 处理所有块
      let block: Block | null;
      while ((block = parser.getNextBlock())) {
        block.release();
      }

      const endTime = performance.now();
      totalTime += endTime - startTime;

      // 显示平均时间
      if (i === test.iterations - 1) {
        console.log(`  平均解析时间: ${(totalTime / test.iterations).toFixed(3)} ms`);
      }
    }
    console.log('');
  }

  console.log('=== 基准测试完成 ===');
}

// 运行测试
runBenchmark();
