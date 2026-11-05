# PostScript 编程语言扩展

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yingquelou.postscriptsnippets?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=yingquelou.postscriptsnippets)
[![Open VSX](https://img.shields.io/open-vsx/v/yingquelou/postscriptsnippets?label=Open%20VSX)](https://open-vsx.org/extension/yingquelou/postscriptsnippets)
[![License: LGPL-3.0](https://img.shields.io/badge/license-LGPL--3.0-blue)](LICENSE)

适用于 Visual Studio Code 的 **PostScript** (Ghostscript) 扩展：提供语法高亮、语言服务器、代码片段以及基于 Ghostscript 的调试运行支持。

同时支持 **VSCodium**、Eclipse Theia 等使用 Open VSX 注册表的编辑器。

## 安装

**VS Code** — 从 [Marketplace](https://marketplace.visualstudio.com/items?itemName=yingquelou.postscriptsnippets) 安装，或使用命令行：

```bash
code --install-extension yingquelou.postscriptsnippets
```

**VSCodium / Theia / Gitpod（Open VSX）** — 从 [Open VSX](https://open-vsx.org/extension/yingquelou/postscriptsnippets) 安装，或使用命令行：

```bash
codium --install-extension yingquelou.postscriptsnippets
```

两个注册表发布的是同一个 VSIX 包。扩展使用 esbuild 打包并内置全部依赖，安装时无需额外下载。

> 仍需自行安装 Ghostscript — 见[系统要求](#系统要求)。

## 功能特性

- **语言支持** — 为 `.ps` 和 `.eps` 文件提供完整语法配置（别名：PostScript, GhostScript）
- **语法高亮** — 完整的 PostScript 源代码语法高亮支持
- **代码大纲** — 内置语言服务器提供代码结构视图，支持数组、字典、过程、字符串等符号导航。`cleartomark`、`pdfmark` 等会消费 mark 的算子，其从 mark 起收集的操作数作为子节点挂在算子下，不再被误报为未闭合数组
- **跳转到定义与工作区符号** — 以 token 为粒度索引工作区内的 `/name … def` 对；未保存缓冲区中的定义优先于磁盘上的旧副本
- **Ghostscript 校验** — `PostScript: Validate with Ghostscript` 用真实解释器运行当前文件（若 `postscript.config.json` 声明了构建单元，则运行整个单元），并把失败报在真正发生的位置。干净运行、`quit` 提前退出、结构化错误与人类可读错误会被区分开，残留 mark 与干净栈分别报告
- **构建追踪** — `PostScript: Generate Build Trace` 以 `run` 影子函数重放配置的构建并写出 `.postscript/build-trace.json`；stderr 顺序即真实执行顺序，嵌套 `run` 同样记录
- **代码片段** — 超过 300+ 标准运算符代码片段
- **调试器** — 完整的 Ghostscript 调试集成，支持断点、单步执行、调试控制台输出
- **PostScript 编译** — 通过工具栏按钮或命令直接在编辑器中编译 PostScript 文件
- **项目配置** — 通过 `postscript.config.json` 定义项目特定设置、依赖项、构建参数和自定义 Ghostscript 路径
- **智能代码补全** — 增强排序、子序列匹配和片段集成的智能代码补全
- **增强的 Ghostscript 检测** — 改进的自动检测，带验证和回退策略，确保可靠的 Ghostscript 集成

## 系统要求

需要安装 **Ghostscript** 并配置到系统 PATH，或在设置中手动指定可执行文件路径。调试器、`Validate with Ghostscript` 与 `Generate Build Trace` 都依赖它。

自动检测顺序:
- **Windows**: `gswin64c` → `gswin32c` → `gs`
- **macOS/Linux**: `gs`

## 快速使用

1. 打开 `.ps` 或 `.eps` 文件
2. 使用「大纲」面板查看代码结构
3. 按 `F5` 键启动 Ghostscript 调试
4. 点击编辑器工具栏的编译按钮编译 PostScript
5. 在项目根目录创建 `postscript.config.json` 进行自定义构建配置
6. 从命令面板运行 `PostScript: Validate with Ghostscript`，用解释器校验当前文件
7. 运行 `PostScript: Generate Build Trace` 记录构建的真实执行顺序

若项目用默认表之外的算子清除 mark（Ghostscript 自带的 `pdfwrite` 源码用的是 `error` 和 `.dicttomark`），把它加进 `postscript.parser.markConsumingOperators`。

---

📚 **文档链接**
- 完整使用指南: [docs/USAGE_GUIDE.zh-CN.md](docs/USAGE_GUIDE.zh-CN.md)
- English Documentation: [README.md](README.md)
