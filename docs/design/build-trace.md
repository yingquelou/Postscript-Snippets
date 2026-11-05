# Design: Build Trace (PostScript's compile_commands.json)

Status: implemented (`postscriptsnippets.generateBuildTrace` command, preamble shipped as `ps/build-trace-preamble.ps`, artifact `.postscript/build-trace.json`) · Scope: project model for the language server
Related: [mark-diagnostics.md](mark-diagnostics.md) (L1/L3 consume the trace)

## Motivation

The language server must analyze projects, not single files — mark
construction, `begin`/`end`, and `save`/`restore` all legally span files. The
cross-language rule is that **a language server never invents a project
model**: clangd consumes `compile_commands.json`, rust-analyzer calls
`cargo metadata`, tsserver shares tsconfig with tsc. PostScript has no build
system to attach to, but the interpreter itself is programmable —
*the interpreter is the linker*, so building is probing.

Therefore: derive the project model from a **real build**, not from a
hand-written config. `postscript.config.json` becomes a fallback / explicit
override; when both exist and disagree, that disagreement is itself a
diagnostic.

## Verified mechanism (end-to-end prototype)

Prototype: [prototype/ps-trace.py](prototype/ps-trace.py) +
[prototype/clean-preamble.ps](prototype/clean-preamble.ps).

1. **Replay** the build instead of instrumenting it: top-level files are
   passed as `-c "(file) run"` in order, with
   `-q -dNODISPLAY -dBATCH -dNOPAUSE -dNOSAFER <preamble.ps>`.
2. The preamble shadows `run` at the **userdict** level: writes
   `===TRACE-RUN===<file>` to stderr, then chains to the original `run`.
   All loading (nested or not) funnels through one channel, so stderr line
   order *is* the real execution order — no merge logic needed.
3. The wrapper parses stderr into `build-trace.json`:

```json
{
  "version": 1,
  "generator": "ps-trace.py",
  "gsExitCode": 0,
  "mainFiles": ["top.ps"],
  "orderedFiles": ["top.ps", "lib.ps", "extra.ps"]
}
```

Verified against gs 10.08: single/double nesting, `run` deferred inside a
procedure (name resolved at execution time), multiple main files with
interleaved order, a library `run` twice (recorded twice), build interrupted
by a PostScript error (partial trace + `gsExitCode: 1`), conditional loading
(only the executed branch is recorded).

## Pitfalls (must-know for the implementation)

- **SAFER**: gs 10 defaults to SAFER. `--permit-file-read` only matches the
  exact path string at `open` time (relative paths never match; `-I` search
  paths don't help) → trace mode must run with `-dNOSAFER`.
- **`writestring` consumes both operands**: the wrapper must protect the file
  argument with `dup` (`dup TR exch writestring`) or the chained `origrun`
  dies with `stackunderflow`.
- **Command-line files bypass userdict**: they enter via
  `runlibfile → findlibfile → run(.systemvar)`, and `.systemvar` skips the
  shadowed binding. Do **not** try to hijack `runlibfile` (internal bind chain
  + 2-deep stack calling convention — it breaks); the replay approach sidesteps
  this entirely.
- `systemdict` is read-only in file-execution context (no need for
  `-dWRITESYSTEMDICT`).
- Filenames embedded in PostScript strings need `\` `(` `)` escaping.
- **Output channels**: trace lines go to **stderr** (the preamble writes via
  `(%stderr)`), program output to stdout — collect them separately. Beware
  `execFileSync`-style helpers that discard the child's stderr.
- **Names are logged verbatim**: the trace records the name as passed to
  `run` (relative paths stay relative). Consumers resolve them against the
  build's working directory.
- **Semantic deltas to document**: replay uses `run` where the real build may
  use `runlibfile` (search-path behavior differs slightly); a trace records the
  execution order of *that* build, so conditionally-loaded files require one
  trace per configuration.

## Integration plan

- Trace artifact: `.postscript/build-trace.json` at the workspace root.
- Refresh triggers: manual command, config change, on-save (debounced).
- Consumers: L1 composition analysis (analysis unit = merged stream of
  `orderedFiles`), L3 validation (run the same command + `-dNODISPLAY`),
  completion context preload.
- `postscript.config.json` hardening (implemented): single path-resolution
  base (the config file's directory — `resolveConfigPath` no longer falls
  back to the current document), exact-path target matching (`matchesCompileFile`
  no longer accepts basename matches), upward config search
  (`getProjectConfigForFile`: nearest config wins, workspace root as
  fallback, shared by the language server and the compile command), and
  semantic diagnostics on the config file (PS010 error / PS011 warning:
  missing referenced files, duplicate target declarations, self-reference,
  structural type errors, cross-level duplicate loads). The active analysis
  unit is advertised via the `postscript/analysisUnit` notification
  (`configUri` + matched target). Cycle detection waits for the build-trace
  graph — the flat preload schema cannot express one.
