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
- **Document outline** — Outline / document symbols (arrays, dictionaries, procedures, strings, names, numbers) provided by the built-in PostScript Language Server. Mark-consuming operators (`cleartomark`, `pdfmark`) keep the operands collected since their mark as children instead of being reported as an unclosed array.
- **Go to Definition & Workspace Symbols** — A token-level index of `/name … def` pairs across the workspace; definitions in an unsaved buffer are offered before the copy on disk.
- **Ghostscript Validation** — `PostScript: Validate with Ghostscript` runs the file (or its whole build unit, when `postscript.config.json` declares one) through the real interpreter and reports the failure where it happened. Clean runs, `quit`, structured and human-readable errors are told apart, and a leftover mark is reported separately from a clean stack.
- **Build Trace** — `PostScript: Generate Build Trace` replays the configured build with `run` shadowed and writes `.postscript/build-trace.json`; stderr order is the real execution order, nested `run` included.
- **Code snippets** — 460+ snippets across 23 operator categories, plus error and custom entries.
- **Debugger** — Run and debug PostScript with Ghostscript, with breakpoints, step operations, and debug console output.
- **PostScript Compilation** — Compile PostScript files directly from the editor with a toolbar button or command.
- **Project Configuration** — Define project-specific settings, dependencies, build arguments, and custom Ghostscript paths via `postscript.config.json`.
- **Intelligent Completion** — Smart code completion with enhanced sorting, subsequence matching, and snippet integration.
- **Enhanced Ghostscript Detection** — Improved auto-detection with validation and fallback strategies for reliable Ghostscript integration.

## Requirements

**Ghostscript** installed and available on `PATH`, or specify the full path in settings. It is used by compilation, by the debugger, by `Validate with Ghostscript` and by `Generate Build Trace`.

Automatic detection order:
- **Windows**: `gswin64c` → `gswin32c` → `gs`
- **macOS/Linux**: `gs`

## Quick Usage

1. Open `.ps` or `.eps` file
2. Use Outline view for document structure
3. Press `F5` to start debugging with Ghostscript
4. Click the compile button in the editor toolbar to compile PostScript
5. Create a `postscript.config.json` in your project root for custom build configuration
6. Run `PostScript: Validate with Ghostscript` from the Command Palette to check the file against the interpreter
7. Run `PostScript: Generate Build Trace` to record the real execution order of the build

If a project clears marks with an operator the defaults do not know about (Ghostscript's own `pdfwrite` sources use `error` and `.dicttomark`), list it in `postscript.parser.markConsumingOperators`.

---

📚 **Documentation Links**
- Full Usage Guide: [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md)
- 中文文档: [README.zh-CN.md](README.zh-CN.md)
