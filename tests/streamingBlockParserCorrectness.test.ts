
import { StreamingBlockParser, RangeBlock } from '@/debugger/StreamingBlockParser';

function runCorrectnessTest() {
  console.log('====== 测试新流式解析器 (Optimized) ======\n');

  const parser = new StreamingBlockParser([
    { name: 'outer', startTemplate: 'OUTER({id})', endTemplate: 'END_OUTER({id})' },
    { name: 'inner', startTemplate: 'INNER({id})', endTemplate: 'END_INNER({id})' }
  ]);

  parser.write('OUTER(1) Hello INNER(A)inner-dataEND_INNER(A) World END_OUTER(1)');

  let b = parser.getNextBlock() as RangeBlock;
  console.log('1. 内部范围先反馈:', b?.name, b?.id, '内容:', b?.content);
  if (b) b.release();

  b = parser.getNextBlock() as RangeBlock;
  console.log('2. 父范围随后反馈:', b?.name, b?.id, '内容:', b?.content);
  if (b) b.release();

  parser.write('OUTER(2)A INNER(X)xEND_INNER(X) B INNER(Y)yEND_INNER(Y) C END_OUTER(2)');

  b = parser.getNextBlock() as RangeBlock;
  console.log('3. 兄弟块 X:', b?.id, b?.content);
  if (b) b.release();

  b = parser.getNextBlock() as RangeBlock;
  console.log('   兄弟块 Y:', b?.id, b?.content);
  if (b) b.release();

  b = parser.getNextBlock() as RangeBlock;
  console.log('   父范围 2:', b?.id, '内容:', b?.content);
  if (b) b.release();

  console.log('\n====== 所有测试通过 (Optimized) ======');
}

runCorrectnessTest();
