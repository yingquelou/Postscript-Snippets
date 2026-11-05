#!/usr/bin/env python3
"""Build-trace wrapper 原型：重放构建 → 捕捉文件执行序 → build-trace.json"""
import json, subprocess, sys, os

def build_trace(files, gs_args=None, gs='gswin64c'):
    """files: 顶层文件序（模拟真实构建的 argv 文件部分）"""
    prelude = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'clean-preamble.ps')
    cmd = [gs, '-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', '-dNOSAFER', prelude]
    for f in files:                              # 重放：顶层文件 → -c "(file) run"
        cmd += ['-c', '({}) run'.format(f.replace('\\', '/').replace('(', r'\(').replace(')', r'\)'))]
    cmd += ['-c', 'quit']
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(files[0])) if files else None)
    ordered = []
    for line in proc.stderr.splitlines():
        if line.startswith('===TRACE-RUN==='):
            ordered.append(line[len('===TRACE-RUN==='):].strip())
    return {
        'version': 1,
        'generator': 'ps-trace.py',
        'gsExitCode': proc.returncode,
        'mainFiles': files,
        'orderedFiles': ordered,   # 真实执行序，含嵌套
    }, proc

if __name__ == '__main__':
    files = sys.argv[1:] or ['top.ps']
    trace, proc = build_trace(files)
    out = 'build-trace.json'
    with open(out, 'w', encoding='utf-8') as fp:
        json.dump(trace, fp, indent=2, ensure_ascii=False)
    print(open(out, encoding='utf-8').read())
    if proc.stdout.strip():
        print('--- 程序 stdout ---'); print(proc.stdout)
