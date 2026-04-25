# PostScript Programming Language

A Visual Studio Code extension for **PostScript** (Ghostscript): syntax highlighting, language server, code snippets, and a debugger that runs PostScript files with Ghostscript.

## Features

- **Language support** — Grammar and language configuration for `.ps` and `.eps` files (aliases: PostScript, GhostScript, OptScript).
- **Syntax highlighting** — PostScript source highlighting via `source.postscript` scope.
- **Document outline** — Outline / document symbols (arrays, dictionaries, procedures, strings, names, numbers) provided by the built-in PostScript Language Server.
- **Code snippets** — Snippets for operators and errors, including:
  - Operand stack, arithmetic, arrays, dictionaries, strings
  - Control, type/conversion, file, resource, virtual memory
  - Graphics state, coordinate system, paths, painting, fonts
  - And more (see **Snippets** in the extension).
- **Debugger** — Run and debug PostScript with Ghostscript:
  - **Breakpoints** — Support for setting breakpoints in PostScript files
  - **Step operations** — Step in, step out, and step next operations
  - **Continue operation** — Continue execution until the next breakpoint, exception, or end of file
  - **Launch configuration** — Support for `stopOnEntry` option to control whether to stop at the entry point
  - **Output** — stdout/stderr in the Debug Console

Note: Document outline and Debugger are not available for files containing binary data (e.g., embedded images), though these files remain valid PostScript.

## Requirements

- **Ghostscript** installed and available on `PATH`, or specify the full path in settings.

The extension automatically detects the appropriate executable based on your platform:
- **Windows**: checks `gswin64c` → `gswin32c` → `gs` (supports native and MSYS2/Cygwin)
- **macOS/Linux**: `gs`

## Usage

1. Open a `.ps` or `.eps` file.
2. Use the **Outline** view for document symbols (from the language server).
3. To run/debug:
   - Open **Run and Debug** (Ctrl+Shift+D / Cmd+Shift+D).
   - Select **PostScript (Ghostscript) Debugger** and the **Launch PostScript** configuration (or add one as below).
   - Start debugging (F5). The debugger runs Ghostscript on the current file and streams output to the Debug Console.

## Configuration

### Extension setting

| Setting | Description | Default |
|--------|-------------|---------|
| `postscript.interpreter.executable` | Ghostscript executable name or full path | Auto-detected from PATH, or platform default |

### Launch configuration

The debugger resolves the Ghostscript executable in the following priority order:

1. `ghostscriptPath` in `launch.json` (highest priority)
2. `postscript.interpreter.executable` in VS Code settings
3. Platform default (auto-detected)

Example `launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "postscript",
      "request": "launch",
      "name": "Launch PostScript",
      "program": "${file}",
      "cwd": "${workspaceFolder}",
      "ghostscriptPath": "gs",
      "args": [],
      "stopOnEntry": false
    }
  ]
}
```

| Property | Description |
|----------|-------------|
| `program` | PostScript file to run (e.g. `${file}` for current file). |
| `ghostscriptPath` | Ghostscript executable path. If not set, uses the extension setting or platform default. |
| `cwd` | Working directory for the interpreter. |
| `args` | Additional arguments passed to Ghostscript. |
| `stopOnEntry` | Whether to stop at the entry point when starting debugging. Default: false. |

**Note:** The `ghostscriptPath` in `launch.json` takes precedence over the extension setting. If neither is set, the debugger automatically detects from `PATH` in the following order:
- Windows: `gswin64c` → `gswin32c` → `gs` (MSYS/MSYS2/Cygwin)
- macOS/Linux: `gs`

## Limitations

- **Binary data in PostScript files** — The Document outline and Debugger features rely on parsing PostScript source code and cannot process files containing binary data sections (e.g., embedded images, font subsets, or EPS files with binary TIFF previews). These files remain valid PostScript and can be executed by Ghostscript; only the extension's parsing-based features are unavailable. Syntax highlighting still works for these files.

## More

- [Ghostscript documentation](https://ghostscript.com/documentation/index.html)
