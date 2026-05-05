# PostScript Extension Usage Guide

Complete user documentation for the PostScript VSCode extension.

---

## 📋 Table of Contents
- [Installation](#installation)
- [Syntax Highlighting](#syntax-highlighting)
- [Document Outline](#document-outline)
- [Code Snippets](#code-snippets)
- [Debugging PostScript](#debugging-postscript)
- [Extension Configuration](#extension-configuration)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)

---

## 🔧 Installation

### Method 1: VSCode Marketplace
1. Open VSCode
2. Open Extensions panel (Ctrl+Shift+X)
3. Search for `PostScript Programming Language`
4. Click Install

### Method 2: Local Installation
1. Download `.vsix` extension package
2. Click menu in top right of Extensions panel
3. Select `Install from VSIX...`
4. Select the downloaded package file

---

## ✨ Syntax Highlighting

Automatically enabled for:
- `.ps` - PostScript source files
- `.eps` - Encapsulated PostScript files

Features:
- ✅ Operator keyword highlighting
- ✅ Complete recognition for strings, numbers, comments
- ✅ Nested syntax highlighting for dictionaries, arrays, procedures
- ✅ Ghostscript extension operator support

---

## 📑 Document Outline

Built-in PostScript Language Server provides structured document outline:

### Supported Symbols:
| Symbol Type | Icon | Description |
|-------------|------|-------------|
| Array | 📦 | PostScript array definitions |
| Dictionary | 📘 | Dictionaries and key-value pairs |
| Procedure | ƒ | Procedure definitions (executable arrays) |
| String | 📝 | String literals |
| Name | 🏷️ | Named definitions |
| Number | 🔢 | Numeric constants |

### Usage:
1. Open PostScript file
2. Open Outline panel on sidebar
3. Click any symbol to jump directly to code location
4. Outline supports fold/unfold hierarchy

---

## 📝 Code Snippets

Over 300+ PostScript standard operator snippets included:

### Categories:
- 🔢 Stack operations & arithmetic
- 📚 Dictionary & array operations
- 📜 String handling
- 🎮 Flow control
- 🖼️ Graphics drawing
- 🔤 Font operations
- ⚙️ Virtual memory management
- 🐛 Debugging & error handling

### Usage:
1. Type operator prefix in PostScript file
2. Press `Ctrl+Space` to trigger autocomplete
3. Use arrows to select desired snippet
4. Press `Tab` to insert, press `Tab` again to navigate placeholders

---

## 🐞 Debugging PostScript

Full Ghostscript debugger integration:

### Prerequisites
✅ Ghostscript installed and available on system PATH
> Download: https://ghostscript.com/releases/gsdnld.html

### Quick Debug Steps:
1. Open `.ps` file to run
2. Open Run and Debug panel (Ctrl+Shift+D)
3. Click `create a launch.json file`
4. Select `PostScript (Ghostscript) Debugger`
5. Press F5 to start debugging

### Debug Operations:
| Operation | Shortcut | Description |
|-----------|----------|-------------|
| Breakpoint | F9 | Set breakpoint on code line |
| Continue | F5 | Run until next breakpoint |
| Step Over | F10 | Execute next statement |
| Stop | Shift+F5 | Terminate debugging |

### Debug Output
All Ghostscript stdout/stderr output appears in the Debug Console panel.

---

## ⚙️ Extension Configuration

### Global Settings
Open Settings (Ctrl+,) search for `postscript` to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| `postscript.interpreter.executable` | Auto-detect | Ghostscript executable path |

### Ghostscript Detection Priority:
1. `ghostscriptPath` configured in `launch.json`
2. Executable path from VSCode global settings
3. Automatic PATH detection:
   - **Windows**: `gswin64c` → `gswin32c` → `gs`
   - **macOS/Linux**: `gs`

---

## ❓ FAQ

**Q: Why doesn't the outline view show anything?**
> Outline requires plain text PostScript. EPS files with binary data or embedded images cannot be parsed. Syntax highlighting will still work.

**Q: Debug says Ghostscript not found?**
> Verify Ghostscript is installed correctly, or manually specify full executable path in settings.

**Q: Breakpoints don't stop during debugging?**
> Ensure breakpoints are set on executable code lines. Comments and blank lines do not support breakpoints.

**Q: Can I debug minified PostScript files?**
> Standard PostScript code is supported. Heavily compressed or obfuscated code may not have correct line position mapping.

---

## 🆘 Troubleshooting

### Debug fails to start
1. Verify Ghostscript runs correctly from command line
2. Try manually specifying full Ghostscript path in settings
3. Check VSCode Developer Tools console for errors

### Syntax highlighting not working
1. Verify file extension is `.ps` or `.eps`
2. Ensure language mode in status bar is set to PostScript
3. Try reloading VSCode window

---

🔗 中文文档: [USAGE_GUIDE.zh-CN.md](USAGE_GUIDE.zh-CN.md)

Please open an issue on GitHub if you encounter other problems.