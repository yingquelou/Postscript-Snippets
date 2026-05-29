# PostScript Programming Language

A Visual Studio Code extension for **PostScript** (Ghostscript): syntax highlighting, language server, code snippets, and a debugger that runs PostScript files with Ghostscript.

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
