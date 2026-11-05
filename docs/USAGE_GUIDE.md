# PostScript Extension Usage Guide

For complete documentation, please visit the [PostScript Extension Wiki](https://github.com/yingquelou/Postscript-Snippets/wiki).

---

## Quick Links

- [Home](https://github.com/yingquelou/Postscript-Snippets/wiki/Home) - Extension overview
- [Usage Guide](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide) - Complete documentation
- [Keyboard Shortcuts](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide#keyboard-shortcuts) - All available shortcuts
- [FAQ](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide#faq) - Frequently asked questions
- [Troubleshooting](https://github.com/yingquelou/Postscript-Snippets/wiki/Usage-Guide#troubleshooting) - Common issues and solutions

---

## Quick Start

1. Install the extension from VSCode Marketplace
2. Install Ghostscript (required for debugging)
3. Open a `.ps` or `.eps` file
4. Press `F5` to start debugging
5. Run `PostScript: Validate with Ghostscript` to check the file against the interpreter
6. Run `PostScript: Generate Build Trace` to record the real execution order

---

## Validating and tracing a build

`PostScript: Validate with Ghostscript` runs the current file — or its whole build unit, when a `postscript.config.json` declares one — through Ghostscript and reports the failure on the line that produced it. Clean runs, `quit`, structured errors and human-readable errors are told apart, and a leftover mark is reported separately from a clean stack.

`PostScript: Generate Build Trace` replays the configured build with `run` shadowed and writes `.postscript/build-trace.json`. The stderr order is the real execution order, nested `run` included.

Both commands resolve the project configuration exactly like the compiler does. If a project clears marks with an operator the defaults do not know about (Ghostscript's own `pdfwrite` sources use `error` and `.dicttomark`), list it in `postscript.parser.markConsumingOperators`; on those sources, adding them drops the structural warnings from 62 to 5.

---

For detailed instructions, please refer to the [Wiki Documentation](https://github.com/yingquelou/Postscript-Snippets/wiki).