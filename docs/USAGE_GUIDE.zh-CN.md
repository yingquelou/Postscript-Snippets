# PostScript 扩展使用指南

完整文档请访问 [PostScript Extension Wiki](https://github.com/yingquelou/Postscript-Snippets/wiki)。

---

## 快速链接

- [主页](https://github.com/yingquelou/Postscript-Snippets/wiki/Home) - 扩展概览
- [使用指南](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide-ZH) - 完整文档
- [快捷键列表](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide-ZH#快捷键列表) - 所有可用的快捷键
- [常见问题](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide-ZH#常见问题) - 常见问题解答
- [故障排除](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide-ZH#故障排除) - 常见问题及解决方案

---

## 快速开始

1. 从 VSCode 市场安装扩展
2. 安装 Ghostscript（调试功能必需）
3. 打开 `.ps` 或 `.eps` 文件
4. 按 `F5` 开始调试
5. 运行 `PostScript: Validate with Ghostscript`，用解释器校验当前文件
6. 运行 `PostScript: Generate Build Trace` 记录真实执行顺序

---

## 校验与构建追踪

`PostScript: Validate with Ghostscript` 用 Ghostscript 运行当前文件（若 `postscript.config.json` 声明了构建单元，则运行整个单元），并把失败报在真正发生的那一行。干净运行、`quit` 提前退出、结构化错误与人类可读错误会被区分开，残留 mark 与干净栈分别报告。

`PostScript: Generate Build Trace` 以 `run` 影子函数重放配置的构建并写出 `.postscript/build-trace.json`。stderr 的顺序就是真实执行顺序，嵌套 `run` 同样记录。

两个命令解析项目配置的方式与编译器完全一致。若项目用默认表之外的算子清除 mark（Ghostscript 自带的 `pdfwrite` 源码用的是 `error` 和 `.dicttomark`），把它们加进 `postscript.parser.markConsumingOperators`；在那些源码上，结构警告会从 62 条降到 5 条。

---

详细说明请参考 [Wiki 文档](https://github.com/yingquelou/Postscript-Snippets/wiki)。