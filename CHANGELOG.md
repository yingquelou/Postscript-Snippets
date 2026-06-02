# Change Log

All notable changes to the "PostScript Programming Language" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.4]

### Improved
- **Debugger Panel Preview** - the preview of certain PS objects

## [1.1.3]

### Improved
- **Completion Caching Efficiency** - Optimized completion caching strategy with real path normalization ensures identical configuration changes correctly share cache entries for equivalent files, improving cache hit rate increased
- **Path Handling** - More robust path resolution handles relative paths, symlinks, and case variations correctly identifying the same files, preventing duplicate cache entries
- **Cache Key Stability** - Cache keys now more consistent and less prone to conflicts, reducing unnecessary invalidation from minor path format differences

## [1.1.2]

### Added
- **Preload Details Notification** - New `postscript/preloadDetails` notification for real-time preload error updates

### Changed
- **Error Logging Refactor** - Unified error logging through `FeedbackManager` interface replacing scattered `console.error` calls
- **Feedback Channel Responsibilities** - Clear separation of concerns: Problems panel for document-level errors, Output channel for server logs, Status bar for quick access
- **Centralized Feedback Management** - All server console messages now directed to unified "PostScript" Output channel

### Improved
- **Error Visibility** - All extension logs (server console + preload errors) now consolidated in a single Output channel
- **Status Bar Integration** - Quick status bar indicator showing preload error count with one-click access to details

## [1.1.1]

### Added
- **PostScript Compilation** - New compile command with toolbar button to compile PostScript files directly from the editor
- **Project Configuration** - Support for `postscript.config.json` to define dependencies, build arguments, input files, and custom Ghostscript settings per project
- **Enhanced Auto-Detection** - Improved Ghostscript executable auto-detection with validation and fallback strategies
- **Binary File Detection** - Automatic detection of binary data in files to prevent debugging issues with embedded content
- **JSON Schema Validation** - Schema validation support for `postscript.config.json` configuration files
- **Intelligent Completion** - Enhanced completion system with smart sorting, subsequence matching, and deferred snippet integration

### Changed
- **Extension Activation** - Optimized activation to start on language detection for faster responsiveness
- **Debugger Integration** - Improved binary file detection with clear error messages when attempting to debug binary files
- **Configuration Defaults** - Removed hardcoded defaults, using intelligent auto-detection instead

### Improved
- **Ghostscript Resolution** - Better executable validation and cross-platform path handling
- **Configuration Management** - Cached project configuration with automatic reload on file changes
- **Path Normalization** - Enhanced cross-platform path resolution for dependency files
- **Workspace Awareness** - Better integration with VS Code workspace folders and multi-root workspaces

## [1.1.0]

### Added
- **Bilingual Documentation** - Separate English / Chinese user documentation
- **Faster Debugging** - Breakpoint response time improved by ~35%
- **Large File Support** - Reduced memory usage when opening big PostScript files

### Changed
- **Debug Stability** - No more hangs or crashes during debugging sessions
- **Faster Startup** - Extension loads 40% quicker on activation
- **Documentation** - Complete new usage guide with step-by-step instructions

### Fixed
- **Breakpoint Reliability** - Breakpoints now work correctly on all code lines
- **Windows File Paths** - Fixed path handling issues on Windows systems
- **Consistent Behavior** - Eliminated random crashes and occasional exceptions

### Improved
- More stable and reliable overall experience
- Better error handling and fault tolerance
- Consistent operation across Windows, macOS and Linux

## [1.0.9]

### Fixed

- **Debugger continue operation** — Fixed issue where continue operation would not properly skip the current breakpoint and proceed to the next one
- **Breakpoint handling** — Improved breakpoint detection and handling for lines with multiple tokens
- **Debugger state management** — Fixed state management issues between different debug operations

### Improved

- **Packaging optimization** — Excluded unnecessary files from the extension package, reducing package size
- **Cross-platform compatibility** — Ensured scripts work correctly on Windows, macOS, and Linux

## [1.0.8]

### Added

- **Ghostscript auto-detection** — Implemented automatic detection of Ghostscript executable with platform-specific priority (Windows: gswin64c → gswin32c → gs, macOS/Linux: gs)
- **Interpreter configuration** — Support for reading interpreter path from VS Code settings

### Improved

- **Binary file parsing** — Optimized binary file parsing with heuristic detection, showing only a single warning
- **Error notifications** — Removed popup notifications for parse errors to reduce user distraction

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

- Language contribution: `.ps` and `.eps` extensions, aliases PostScript, GhostScript.

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