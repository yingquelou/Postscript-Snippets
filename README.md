# PostScript

This Visual Studio Code extension provides `PostScript` language snippets and a lightweight debugger that uses `Ghostscript` to run `PostScript` files.

Requirements

- Ghostscript installed and available in PATH (`gswin64c` 、`gswin32c`、 `gs`).

Usage

- Open a `.ps` file.
- Open the Run and Debug side bar, choose "PostScript (Ghostscript) Debugger" and use the provided "Launch PostScript (Ghostscript)" configuration.
- The debugger will run Ghostscript against the current file and stream stdout/stderr into the Debug Console.

Configuration

- `ghostscriptPath`: optional override for the Ghostscript executable name or full path.

Additional Debugger Features

Example `launch.json`

```json
{
	"version": "0.2.0",
	"configurations": [
		{
			"type": "postscript",
			"request": "launch",
			"name": "PostScript (Ghostscript)",
			"program": "${file}",
			"ghostscriptPath": "gs"
		}
	]
}
```

More

See Ghostscript docs: https://ghostscript.com/documentation/index.html