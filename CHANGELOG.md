# Change Log

All notable changes to the "PostScript Programming Language" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.7]

### Added

- PostScript Language Server (in-process) with:
  - **Document symbols** — Outline for arrays, dictionaries, procedures, strings, names, and numbers.
  - **Completion** — Basic completion support.
  - **Hover** — Hover information for PostScript elements.
  - **Diagnostics** — Parser-based validation and error reporting.

 - **User notifications** — When the language server detects parse errors it will post diagnostics to the Problems panel and show a one-time notification when errors first appear or are resolved.
- README updated with feature list, configuration, and usage.

### Changed

- Document symbol provider refactored into the language server; outline is now provided via LSP.
- Extension starts the language server and uses `vscode-languageclient` to communicate with it.

## [1.0.6]

### Added

- Breakpoint support for PostScript in the Run and Debug view.
- Launch configuration snippets and debug configuration provider for easier setup.

### Changed

- Debug adapter and launch options (e.g. `program`, `ghostscriptPath`, `cwd`, `args`) aligned with extension configuration.

## [1.0.5]

### Added

- Configuration setting `postscript.interpreter.executable` for Ghostscript path.
- Grammar (TextMate) for PostScript: `source.postscript` syntax highlighting.

### Changed

- Language contribution: `.ps` and `.eps` extensions, aliases PostScript, GhostScript, OptScript.

## [1.0.0]

### Added

- Initial release.
- PostScript language support (file extensions, language configuration).
- Code snippets for operators and errors (stack, arithmetic, arrays, dictionaries, strings, control, graphics, fonts, etc.).
- PostScript (Ghostscript) debugger: run PostScript files with Ghostscript, stdout/stderr in Debug Console.
- Debugger launch configuration: `program`, `ghostscriptPath`, `cwd`, `args`.

## Prior to 1.0.0

### Notes

- Initial prototype and grammar development: lexer/parser experiments and TextMate grammar for syntax highlighting.
- Early collection of operator snippets and example PostScript files to demonstrate language features.
- Foundational tests and CI setup; feedback-driven improvements prior to the stable 1.0.0 release.