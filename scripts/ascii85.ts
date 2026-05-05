// 静态查找表：将 ASCII 字符映射为 base-85 数值或控制标记
// -1: 空白/无效字符 (忽略)
// -2: 'z' 快捷符号 (代表 4 个零字节)
// 0..84: 对应字符 '!'..'u' 的数值
const TABLE = new Int8Array(256);
TABLE.fill(-1);
for (let i = 33; i <= 117; i++) {
    TABLE[i] = i - 33; // '!' = 0, 'u' = 84
}
TABLE[122] = -2; // 'z'

/**
 * 极致高效的 Ascii85 (Adobe/PostScript 变种) 解码器。
 * 支持 `<~ ~>` 包裹的流、空白字符自动忽略、`z` 快捷符号以及最后不完整分组的正确解码。
 * @param input 原始 ASCII85 字符串
 * @returns 解码后的字节数组 (Uint8Array)
 */
export function ascii85Decode(input: string): Uint8Array {
    const len = input.length;
    // 安全上限：每个字符最多产出 4 字节（'z'），预分配足够避免动态扩容
    const outBuffer = new ArrayBuffer(len * 4);
    const out = new Uint8Array(outBuffer);
    let outPos = 0;
    let num = 0;      // 当前分组的累积值
    let count = 0;    // 当前分组已收集的字符数 (0..4)

    for (let i = 0; i < len; i++) {
        const byte = input.charCodeAt(i);

        // 结束符 '~>' 检测
        if (byte === 126) { // '~'
            if (i + 1 < len && input.charCodeAt(i + 1) === 62) { // '>'
                break;
            }
            // 孤立 '~' 视为无效字符忽略
            continue;
        }

        const val = TABLE[byte];

        // 空白 / 无意义字符
        if (val === -1) continue;

        // 'z' 快捷符号 → 4 个零字节
        if (val === -2) {
            // 若已累积部分字符，属于格式错误，清空后继续（极致高效不抛异常）
            if (count > 0) {
                count = 0;
                num = 0;
            }
            out[outPos++] = 0;
            out[outPos++] = 0;
            out[outPos++] = 0;
            out[outPos++] = 0;
            continue;
        }

        // 常规 base-85 字符累积
        num = num * 85 + val;
        count++;

        // 满 5 个字符，产出 4 字节（大端序）
        if (count === 5) {
            out[outPos++] = (num >>> 24) & 0xFF;
            out[outPos++] = (num >>> 16) & 0xFF;
            out[outPos++] = (num >>> 8) & 0xFF;
            out[outPos++] = num & 0xFF;
            num = 0;
            count = 0;
        }
    }

    // 处理最后不足 5 字符的剩余分组
    if (count > 0) {
        // 用 'u' (84) 填充至 5 字符
        for (let i = count; i < 5; i++) {
            num = num * 85 + 84;
        }
        // 输出 count - 1 个字节（大端序高位字节）
        if (count >= 2) out[outPos++] = (num >>> 24) & 0xFF;
        if (count >= 3) out[outPos++] = (num >>> 16) & 0xFF;
        if (count >= 4) out[outPos++] = (num >>> 8) & 0xFF;
        // count == 1 时无输出
    }

    // 返回与 outBuffer 共享内存的精确长度视图，避免复制
    return new Uint8Array(outBuffer, 0, outPos);
}