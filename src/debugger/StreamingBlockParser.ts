
// ================================================================
//  streaming-parser-final.ts (Optimized Version)
// ================================================================

export interface RangeDefinition {
  name: string;
  startTemplate: string;   // 必须包含恰好一个 {id}
  endTemplate: string;
}

export interface RangeBlock {
  type: 'range';
  name: string;
  id: string;
  content: string;         // 已剔除所有子范围
  raw: string;              // 完整原始字符串（含标记）
  release: () => void;
}

export interface FreeBlock {
  type: 'free';
  data: string;
  release: () => void;
}

export type Block = RangeBlock | FreeBlock;

// ---------- 内部结构 ----------
interface ParsedDef {
  name: string;
  startPrefix: string;
  startSuffix: string;
  endPrefix: string;
  endSuffix: string;
}

interface StackFrame {
  defIdx: number;
  id: string;
  contentStart: number;    // 内容在 buffer 中的起始索引
  contentEnd: number | null;
  rawStart: number;        // 范围在 buffer 中的起始索引（含开始标记）
  rawEnd: number | null;   // 范围在 buffer 中的结束索引（含结束标记）
  parent: StackFrame | null;
  pendingChildren: number;
  childRanges: { start: number; end: number }[]; // 相对父 contentStart 的偏移，保持有序
  endMarker: string;       // 缓存的结束标记
}

export class StreamingBlockParser {
  private defs: ParsedDef[];
  private buffer = '';
  private stack: StackFrame[] = [];
  private scanPos = 0;
  private pendingBlocks: Block[] = [];
  private freePending = false;
  private frameByBlock = new WeakMap<Block, StackFrame>();

  constructor(defs: RangeDefinition[]) {
    this.defs = defs.map(d => {
      const sp = d.startTemplate.split('{id}');
      const ep = d.endTemplate.split('{id}');
      if (sp.length !== 2 || ep.length !== 2) {
        throw new Error(`${d.name}: 模板必须恰好包含一个 {id}`);
      }
      return {
        name: d.name,
        startPrefix: sp[0],
        startSuffix: sp[1],
        endPrefix: ep[0],
        endSuffix: ep[1],
      };
    });
  }

  /** 喂入数据，支持 string 或 Buffer */
  write(chunk: string | Buffer): void {
    if (typeof chunk !== 'string') {
      chunk = chunk.toString('utf-8');
    }
    this.buffer += chunk;
    if (this.pendingBlocks.length === 0) {
      this._parse();
    }
  }

  /** 获取下一个已就绪的块（Range 或 Free） */
  getNextBlock(): Block | null {
    return this.pendingBlocks[0] ?? null;
  }

  /** 主动请求游离数据（当前未被任何范围包裹的数据） */
  fetchFreeData(): FreeBlock | null {
    if (this.freePending || this.stack.length > 0) return null;
    
    if (this.pendingBlocks.length === 0) {
      this._parse();
    }
    
    if (this.pendingBlocks.length > 0) return null;
    if (this.buffer.length === 0) return null;

    const data = this.buffer;
    const block: FreeBlock = {
      type: 'free',
      data,
      release: () => this._releaseFreeBlock(block),
    };
    this.pendingBlocks.push(block);
    this.freePending = true;
    return block;
  }

  // -----------------------------------------------------------------
  private _parse(): void {
    while (this.pendingBlocks.length === 0) {
      const start = this._findEarliestStart(this.scanPos);
      const endInfo = this._findImmediateEnd(this.scanPos);

      if (!start && !endInfo) break;

      let useEnd = false;
      if (start && endInfo) {
        const endMarker = endInfo.frame.endMarker;
        const endStart = endInfo.endPos - endMarker.length;
        if (start.startPos >= endStart && start.startPos < endInfo.endPos) {
          useEnd = true;
        } else {
          useEnd = endInfo.endPos <= start.startPos;
        }
      } else if (endInfo) {
        useEnd = true;
      }

      if (useEnd) {
        const { frame, endPos } = endInfo!;
        frame.rawEnd = endPos;
        const endMarker = frame.endMarker;
        frame.contentEnd = endPos - endMarker.length;

        if (frame.parent) {
          const offset = frame.rawStart - frame.parent.contentStart;
          const len = frame.rawEnd - frame.rawStart;
          // 按顺序插入子范围保持有序
          const childRange = { start: offset, end: offset + len };
          let inserted = false;
          for (let i = 0; i < frame.parent.childRanges.length; i++) {
            if (frame.parent.childRanges[i].start > offset) {
              frame.parent.childRanges.splice(i, 0, childRange);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            frame.parent.childRanges.push(childRange);
          }
          frame.parent.pendingChildren++;
        }

        const block = this._createRangeBlock(frame);
        this.pendingBlocks.push(block);
        this.scanPos = frame.rawEnd;
        break;
      } else {
        this._pushFrame(start!);
      }
    }
  }

  private _createRangeBlock(frame: StackFrame): RangeBlock {
    const content = this._buildContent(frame);
    const raw = this.buffer.slice(frame.rawStart, frame.rawEnd!);
    const block: RangeBlock = {
      type: 'range',
      name: this.defs[frame.defIdx].name,
      id: frame.id,
      content,
      raw,
      release: () => this._releaseRangeBlock(block),
    };
    this.frameByBlock.set(block, frame);
    return block;
  }

  /** 构建范围内容：剔除所有已注册的子范围（已优化，无需排序） */
  private _buildContent(frame: StackFrame): string {
    const end = frame.contentEnd!;
    const base = frame.contentStart;
    let result = '';
    let cursor = base;
    // 子范围列表已保持有序，无需排序
    const children = frame.childRanges;
    for (const child of children) {
      const childStart = base + child.start;
      const childEnd = base + child.end;
      if (cursor < childStart) {
        result += this.buffer.slice(cursor, childStart);
      }
      cursor = Math.max(cursor, childEnd);
    }
    if (cursor < end) {
      result += this.buffer.slice(cursor, end);
    }
    return result;
  }

  /** 查找最早的开始标记 */
  private _findEarliestStart(fromIdx: number) {
    let bestPos = Infinity;
    let best: { defIdx: number; id: string; startPos: number; startEnd: number } | null = null;
    for (let i = 0; i < this.defs.length; i++) {
      const d = this.defs[i];
      const prefixPos = this.buffer.indexOf(d.startPrefix, fromIdx);
      if (prefixPos === -1) continue;
      const idStart = prefixPos + d.startPrefix.length;
      const idEnd = this.buffer.indexOf(d.startSuffix, idStart);
      if (idEnd === -1) continue;
      const id = this.buffer.slice(idStart, idEnd);
      const startEnd = idEnd + d.startSuffix.length;
      if (prefixPos < bestPos) {
        bestPos = prefixPos;
        best = { defIdx: i, id, startPos: prefixPos, startEnd };
      }
    }
    return best;
  }

  /** 查找栈中最内层未闭合帧的结束标记 */
  private _findImmediateEnd(fromIdx: number) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.rawEnd !== null) continue;
      const endMarker = frame.endMarker;
      const endPos = this.buffer.indexOf(endMarker, fromIdx);
      if (endPos !== -1) {
        return { frame, endPos: endPos + endMarker.length };
      }
      return null;
    }
    return null;
  }

  /** 将新的开始匹配压入栈中 */
  private _pushFrame(start: { defIdx: number; id: string; startPos: number; startEnd: number }) {
    let parent: StackFrame | null = null;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].rawEnd === null) {
        parent = this.stack[i];
        break;
      }
    }
    const def = this.defs[start.defIdx];
    const endMarker = def.endPrefix + start.id + def.endSuffix;
    const frame: StackFrame = {
      defIdx: start.defIdx,
      id: start.id,
      contentStart: start.startEnd,
      contentEnd: null,
      rawStart: start.startPos,
      rawEnd: null,
      parent,
      pendingChildren: 0,
      childRanges: [],
      endMarker,
    };
    this.stack.push(frame);
    this.scanPos = start.startEnd;
  }

  /** 释放已消费的范围块 */
  private _releaseRangeBlock(block: RangeBlock) {
    const idx = this.pendingBlocks.indexOf(block);
    if (idx !== 0) throw new Error('必须按顺序释放块。');
    this.pendingBlocks.shift();

    const frame = this.frameByBlock.get(block)!;
    if (frame.parent) {
      frame.parent.pendingChildren--;
      if (frame.parent.rawEnd !== null && frame.parent.pendingChildren === 0) {
        this._emitParentBlock(frame.parent);
      }
    }
    this._removeFrame(frame);
    this._compactMemory();
    if (this.pendingBlocks.length === 0) this._parse();
  }

  /** 释放游离块 */
  private _releaseFreeBlock(block: FreeBlock) {
    const idx = this.pendingBlocks.indexOf(block);
    if (idx !== 0) throw new Error('必须按顺序释放块。');
    this.pendingBlocks.shift();
    this.freePending = false;
    this.buffer = '';
    this.scanPos = 0;
    if (this.pendingBlocks.length === 0) this._parse();
  }

  /** 为已闭合且子块全部释放的父帧生成块 */
  private _emitParentBlock(frame: StackFrame) {
    const block = this._createRangeBlock(frame);
    this.pendingBlocks.push(block);
    this._removeFrame(frame);
    this._compactMemory();
  }

  private _removeFrame(frame: StackFrame): void {
    const pos = this.stack.indexOf(frame);
    if (pos !== -1) this.stack.splice(pos, 1);
  }

  /** 丢弃所有活跃帧起始位置之前的数据，释放内存 */
  private _compactMemory(): void {
    if (this.stack.length === 0) {
      if (this.scanPos > 0) {
        this.buffer = this.buffer.slice(this.scanPos);
        this.scanPos = 0;
      }
      return;
    }
    
    let minRaw = Infinity;
    for (const f of this.stack) {
      if (f.rawStart < minRaw) minRaw = f.rawStart;
    }
    const keepFrom = Math.min(minRaw, this.scanPos);
    if (keepFrom > 0) {
      this.buffer = this.buffer.slice(keepFrom);
      this.scanPos -= keepFrom;
      for (const f of this.stack) {
        f.rawStart -= keepFrom;
        f.contentStart -= keepFrom;
        if (f.contentEnd !== null) f.contentEnd -= keepFrom;
        if (f.rawEnd !== null) f.rawEnd -= keepFrom;
      }
    }
  }
}

export const streamingBlockParser = new StreamingBlockParser([
  {
    name: 'pause', startTemplate: 'PS_EVAL_START({id})',
    endTemplate: 'PS_EVAL_END({id})'
  },
  {
    name: 'stepping', startTemplate: 'PS_DBG_START({id})',
    endTemplate: 'PS_DBG_END({id})'
  },
  {
    name: 'error', startTemplate: 'ERROR_START({id})',
    endTemplate: 'ERROR_END({id})'
  }
])
