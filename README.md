# PostScript Programming Language

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yingquelou.postscriptsnippets?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=yingquelou.postscriptsnippets)
[![Open VSX](https://img.shields.io/open-vsx/v/yingquelou/postscriptsnippets?label=Open%20VSX)](https://open-vsx.org/extension/yingquelou/postscriptsnippets)
[![License: LGPL-3.0](https://img.shields.io/badge/license-LGPL--3.0-blue)](LICENSE)

A Visual Studio Code extension for **PostScript** (Ghostscript): syntax highlighting, language server, code snippets, and a debugger that runs PostScript files with Ghostscript.

Works in **VS Code** as well as **VSCodium**, Eclipse Theia and other editors that use the Open VSX registry.

## Installation

**VS Code** — install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=yingquelou.postscriptsnippets), or from the command line:

```bash
code --install-extension yingquelou.postscriptsnippets
```

**VSCodium / Theia / Gitpod (Open VSX)** — install from [Open VSX](https://open-vsx.org/extension/yingquelou/postscriptsnippets), or from the command line:

```bash
codium --install-extension yingquelou.postscriptsnippets
```

Both registries receive the exact same VSIX. The extension is bundled with esbuild and ships all of its dependencies, so nothing extra is downloaded at install time.

> Ghostscript is still required — see [Requirements](#requirements).

## Features

- **Language support** — Grammar and language configuration for `.ps` and `.eps` files (aliases: PostScript, GhostScript).
- **Syntax highlighting** — PostScript source highlighting via `source.postscript` scope.
- **Document outline** — Outline / document symbols (arrays, dictionaries, procedures, strings, names, numbers) provided by the built-in PostScript Language Server.
- **Code snippets** — Snippets for operators and errors.
- **Debugger** — Run and debug PostScript with Ghostscript, with breakpoints, step operations, and debug console output.
- **PostScript Compilation** — Compile PostScript files directly from the editor with a toolbar button or command.
- **Project Configuration** — Define project-specific settings, dependencies, build arguments, and custom Ghostscript paths via `postscript.config.json`.
- **Intelligent Completion** — Smart code completion with enhanced sorting, subsequence matching, and snippet integration.
- **Enhanced Ghostscript Detection** — Improved auto-detection with validation and fallback strategies for reliable Ghostscript integration.

## Requirements

**Ghostscript** installed and available on `PATH`, or specify the full path in settings.

Automatic detection order:
- **Windows**: `gswin64c` → `gswin32c` → `gs`
- **macOS/Linux**: `gs`

## Quick Usage

1. Open `.ps` or `.eps` file
2. Use Outline view for document structure
3. Press `F5` to start debugging with Ghostscript
4. Click the compile button in the editor toolbar to compile PostScript
5. Create a `postscript.config.json` in your project root for custom build configuration

---

📚 **Documentation Links**
- Full Usage Guide: [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md)
- 中文文档: [README.zh-CN.md](README.zh-CN.md)
