import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { StreamingBlockParser, RangeBlock } from '../out/debugger/StreamingBlockParser.js';

const TEMPLATES = [
  { name: 'outer', startTemplate: 'OUTER({id})', endTemplate: 'END_OUTER({id})' },
  { name: 'inner', startTemplate: 'INNER({id})', endTemplate: 'END_INNER({id})' }
];

function next(parser: StreamingBlockParser): RangeBlock | undefined {
  const block = parser.getNextBlock() as RangeBlock;
  return block ?? undefined;
}

describe('StreamingBlockParser correctness', () => {
  it('emits nested blocks before their parent, stripping inner ranges', () => {
    const parser = new StreamingBlockParser(TEMPLATES);
    parser.write('OUTER(1) Hello INNER(A)inner-dataEND_INNER(A) World END_OUTER(1)');

    const inner = next(parser);
    assert.ok(inner);
    assert.strictEqual(inner!.name, 'inner');
    assert.strictEqual(inner!.id, 'A');
    assert.strictEqual(inner!.content, 'inner-data');
    inner!.release();

    const outer = next(parser);
    assert.ok(outer);
    assert.strictEqual(outer!.name, 'outer');
    assert.strictEqual(outer!.id, '1');
    // the nested range is removed from the parent content
    assert.ok(!outer!.content.includes('inner-data'));
    assert.ok(outer!.content.includes('Hello'));
    assert.ok(outer!.content.includes('World'));
    outer!.release();

    assert.strictEqual(next(parser), undefined);
  });

  it('emits sibling blocks in order after a second write', () => {
    const parser = new StreamingBlockParser(TEMPLATES);
    parser.write('OUTER(2)A INNER(X)xEND_INNER(X) B INNER(Y)yEND_INNER(Y) C END_OUTER(2)');

    const ids: string[] = [];
    for (let block = next(parser); block; block = next(parser)) {
      ids.push(`${block.name}:${block.id}`);
      block.release();
    }
    assert.deepStrictEqual(ids, ['inner:X', 'inner:Y', 'outer:2']);
  });
});
