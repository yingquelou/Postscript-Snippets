# Change Log

All notable changes to the "PostScript Programming Language" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.9]

### Added
- **Ghostscript Validation** - `PostScript: Validate with Ghostscript` runs the document (or its whole build unit, when a `postscript.config.json` declares it) through the real interpreter and reports the failure where it happened. A run is classified instead of assumed: clean, stopped early by `quit`, structured error, human-readable error, failure with no attribution, and interpreter crash. A failure that cannot be attributed is reported as such rather than pinned to a guessed position, and a leftover mark is reported separately from a clean stack
- **Build Trace** - `PostScript: Generate Build Trace` replays the configured build with a `userdict`-level `run` shadow and writes `.postscript/build-trace.json`; stderr order is the real execution order, nested `run` included
- **Analysis Unit** - Compile and analysis share one config lookup (a config next to the sources wins over the workspace root), and the status bar shows the active config and matched target
- **Go to Definition / Workspace Symbols** - A token-level workspace index of `/name … def` pairs; unsaved buffers win over disk
- **Mark-Aware Outline** - `cleartomark` and `pdfmark` keep the operands collected since their mark as children of the operator instead of being reported as an unclosed array; `clear` drops pending marks silently. Both operator tables are configurable through `postscript.parser.markConsumingOperators` and `postscript.parser.markSuspendingOperators`. The defaults hold only operators Ghostscript 10.08 actually has (it has no `clearstack`), so no entry can be dead weight

### Changed
- **Structural Diagnostics Are Graded** - An unclosed-mark warning becomes a hint when gs runs exactly this document version cleanly (`PS014`) or when the construct balances in the merged build stream (`PS012`), stays a warning otherwise (`PS009`), and parse errors are never downgraded (`PS001`)
- **Config Paths Resolve From One Base** - Relative entries in `postscript.config.json` always resolve against the config file's directory; basename matching is gone, so `foo.ps` in another directory can no longer silently match a target
- **Interpreter-Backed Verification** - `verify:parity`, `verify:ps` and `verify:trace` check the shipped `.ps` files, the documented mark semantics and the `gs` command lines against the real interpreter; they bundle from source, so they no longer depend on `out/` surviving a package run. CI runs the aggregate `npm run verify`
- **Package Manifest Restore** - `package` and `publish` go through a wrapper, so a failed or interrupted run also restores `package.json` (npm never runs `post<script>` on failure)

### Fixed
- **Immediate Names Match the Mark Tables** - `//name` denotes the same operator as the bare `name` (gs 10.08: `mark 1 2 //cleartomark` leaves `count` 0, `mark /a 1 //.dicttomark` yields a dict), so the prefix is normalized before the table lookup and one entry covers both spellings. Previously `mark (msg) //error exec` was reported as an orphan mark even when `error` was configured as a consumer, which made the setting ineffective on the most common gs idiom. With `error` and `.dicttomark` added to `postscript.parser.markConsumingOperators`, gs' own pdfwrite implementation drops from 62 warnings to 5
- **Explicit Debugger Path** - A `ghostscriptPath` in `launch.json` that fails validation is reported instead of being silently replaced by an auto-detected interpreter

## [1.1.8]

### Added
- **Extension Icon** - The marketplace listing now has a proper icon: a 128x128 mark built from `%!`, the magic number every PostScript file starts with

### Changed
- **Tokenless Releases** - Publishing to both registries now uses OIDC trusted publishing (`vsce publish --oidc`, `ovsx publish --trusted-publishing`); the repository no longer needs `VSCE_PAT` or `OVSX_PAT`, and a guard step fails the build if either re-appears

### Removed
- **Open VSX Preflight Check** - Publishing no longer probes the registry before uploading; the API sits behind a CDN with a 10-minute TTL and a stale edge node could falsely report the namespace as unverified, silently skipping a correct release

## [1.1.7]

### Added
- **Open VSX Publishing** - The extension is now also published to [Open VSX](https://open-vsx.org/extension/yingquelou/postscriptsnippets), making it installable in VSCodium, Eclipse Theia, Gitpod and other editors that only consume the Open VSX registry
- **Automated Release** - GitHub Actions workflow that builds, verifies and publishes the same VSIX to both the VS Code Marketplace and Open VSX when a `v*` tag is pushed
- **License Metadata** - Added the `LGPL-3.0-only` license field to `package.json` so both registries display the correct license

### Changed
- **README** - Added an Installation section covering the VS Code Marketplace, Open VSX and VSCodium, plus registry badges
- **Packaging Hardening** - `npm run package` and `npm run publish` now wipe `out/` before rebuilding, so TypeScript artifacts left behind by `npm test` or `tsc -b` can no longer leak into the VSIX (previously 47 stray files); the VSIX is additionally restricted to the two bundled entry points

## [1.1.6]

### Fixed
- **Completion Isolation** - Files not declared in configuration file are now properly isolated from buildArgs of other files; this fixes an issue where `-sstdout=...` parameters in one file's configuration would incorrectly disable dynamic completion for all other files
- **Configuration Change Response** - Configuration file changes now properly trigger reloading of preloaded entries for all open documents, ensuring completion reflects updated `buildArgs`, `inputs`, and other configuration changes
- **Debugger stderr Handling** - Fixed incorrect JSON parsing of Ghostscript stderr output; stderr content is now properly displayed as plain text in the debug console since DAP errors are transmitted via stdout with block markers

## [1.1.5]

### Changed
- **Configuration Change Feedback** - Configuration file updates now log to the Output channel instead of showing popup notifications, reducing user distraction
- **Code Refactoring** - Output channel creation moved from language server client to extension activation function for better architectural separation
- **Duplicate Listener Removal** - Removed redundant configuration file watcher from compile command, now relying solely on language server's existing listener

### Improved
- **Reduced Popup Notifications** - Minimized intrusive UI notifications; configuration changes are now logged silently to the PostScript Output channel
- **Code Maintainability** - Eliminated duplicate configuration monitoring logic across modules

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