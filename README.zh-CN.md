# PostScript 编程语言扩展

适用于 Visual Studio Code 的 **PostScript** (Ghostscript) 扩展：提供语法高亮、语言服务器、代码片段以及基于 Ghostscript 的调试运行支持。

## 功能特性

- **语言支持** — 为 `.ps` 和 `.eps` 文件提供完整语法配置（别名：PostScript, GhostScript）
- **语法高亮** — 完整的 PostScript 源代码语法高亮支持
- **代码大纲** — 内置语言服务器提供代码结构视图，支持数组、字典、过程、字符串等符号导航
- **代码片段** — 超过 300+ 标准运算符代码片段
- **调试器** — 完整的 Ghostscript 调试集成，支持断点、单步执行、调试控制台输出

## 系统要求

需要安装 **Ghostscript** 并配置到系统 PATH，或在设置中手动指定可执行文件路径。

自动检测顺序:
- **Windows**: `gswin64c` → `gswin32c` → `gs`
- **macOS/Linux**: `gs`

## 快速使用

1. 打开 `.ps` 或 `.eps` 文件
2. 使用「大纲」面板查看代码结构
3. 按 `F5` 键启动 Ghostscript 调试

---

📚 **文档链接**
- 完整使用指南: [docs/USAGE_GUIDE.zh-CN.md](docs/USAGE_GUIDE.zh-CN.md)
- English Documentation: [README.md](README.md)
