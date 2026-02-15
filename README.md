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
- **Debugger** — Run and debug PostScript with Ghostscript; breakpoints supported; stdout/stderr in the Debug Console.

## Requirements

- **Ghostscript** installed and on `PATH`, e.g.:
  - Windows: `gswin64c`, `gswin32c`, or `gs`
  - macOS/Linux: `gs`

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
| `postscript.interpreter.executable` | Ghostscript executable name or full path | `gs` |

### Launch configuration

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
      "args": []
    }
  ]
}
```

| Property | Description |
|----------|-------------|
| `program` | PostScript file to run (e.g. `${file}` for current file). |
| `ghostscriptPath` | Ghostscript executable (e.g. `gs`, `gswin64c`). |
| `cwd` | Working directory for the interpreter. |
| `args` | Additional arguments passed to Ghostscript. |

## More

- [Ghostscript documentation](https://ghostscript.com/documentation/index.html)
