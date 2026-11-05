# Survey: Ghostscript interfaces usable by this extension

Status: research note · Every claim marked **verified** was re-run against
gs 10.08.0 (gswin64c, msys2 clang64 build) on 2026-11-05; claims marked
**documented** come from the official docs without a local repro.

Purpose: answer "does Ghostscript offer a debugging interface or anything else
the language server could use?" — and decide, per item, whether it earns its
place in this extension.

## 0. What is already in use

| Facility | Where |
|----------|-------|
| `-q -dNODISPLAY -dBATCH -dNOPAUSE` + temp-file snapshot | `validateWithGhostscript.ts` (L3) |
| `-dNOSAFER` + preamble file | `buildTrace.ts` |
| `-dNOPAUSE -dNOPROMPT -dBATCH -dQUIET -sDEVICE=nullpage` + stdin REPL | `language-server/ghostscriptRunner.ts` |
| `-sstdout=- -sstderr=-` + stdin | `debugger/debugAdapter.ts` |
| stdin as the program stream (`-`) with the `PS_EVAL` protocol | debugger console |
| `--permit-file-read` / `-c "…run"` | build trace probe |
| `$error`-free scraping of `Error: /x in y` + `Current file position is N` | `gsParsers.ts` |

Everything below is *additional*.

## 1. In-process embedding: `gsapi_*` (the real "debug interface")

Official documentation: `API.html` (Ghostscript C API, "Embedding Ghostscript").

Documented surface relevant to a language server:

| Function | What it gives |
|----------|---------------|
| `gsapi_run_string_begin / _continue / _end` | feed source in **chunks**, not one file per process; each call ≤ 64 KB; `_continue` returns `gs_error_NeedInput` on success |
| `gsapi_run_file`, `gsapi_run_string_with_length` | one-shot execution |
| `gsapi_set_stdio(_with_handle)` | capture stdout/stderr as **callbacks** instead of pipes |
| `gsapi_set_poll(_with_handle)` | cooperative cancellation (documented as only called when built with `CHECK_INTERRUPTS`) |
| `gsapi_set_param / get_param / enumerate_params` | `-d`/`-s` equivalents at runtime |
| `gsapi_set_arg_encoding` | argument encoding (must precede init) |

**Verified locally** by loading `libgs-10.dll` through ctypes (no build step):

```
gsapi_revision            → 0, product "GPL Ghostscript", revision 10.080
gsapi_new_instance        → 0
gsapi_init_with_args      → 0   (argv: gs -q -dNODISPLAY -dBATCH -dNOPAUSE)
gsapi_run_string_begin    → 0
gsapi_run_string_continue → -106  (NeedInput, i.e. success; chunk "(PIECE-1) print…")
gsapi_run_string_continue → -24   (error; chunk "…1 2 ]")
gsapi_exit                → 0
captured stdout           → "PIECE-1\nPIECE-2\nUnrecoverable error: unmatchedmark in ]\nOperand stack:\n    1  2  1  2\n"
```

So the API is not theoretical: a session can be created, fed in pieces, and its
output captured in-process, with error codes returned per chunk.

**What it would buy:** a persistent interpreter (definitions from one check
survive into the next), true step-wise feeding controlled by the extension, and
no pipe parsing.

**Why it is not adopted now:** it requires a native FFI dependency
(`koffi`/`ffi-napi`) plus a gs shared library per platform
(`gsdll64.dll` on Windows; `libgs-10.dll` here; `libgs.so`/`.dylib` elsewhere)
that is *not* guaranteed to sit next to the `gs` binary the user configured.
That is a packaging and support cost for a feature the current one-shot
validation already covers. Revisit only if a persistent session becomes a real
requirement.

## 2. Process-level interfaces usable today

### 2.1 `$error` + `errordict /handleerror` — structured diagnostics

This is the closest thing to an official "error API" reachable without FFI.
PLRM defines it; gs implements it. **Verified** on 10.08.0:

| Step | Command / result |
|------|------------------|
| install from the command line | `gs -q -dNODISPLAY -c "errordict /handleerror { … } put" -f file.ps` — works under the default SAFER, no `-dNOSAFER` needed |
| keys present in `$error` | `/dstack /errorinfo /recordstacks /.inerror /.nosetlocal /estack /errorname /command /SubstituteFont /position /binary /ostack /newerror /globalmode` |
| sample values for `1 2 ]` | `errorname = /unmatchedmark`, `command = --]--`, `position = 5`, `ostack = [1 2]`, `estack` length 43, `newerror = true`, `recordstacks = true` |
| `position` semantics | same number the default handler prints as `Current file position is N` (1-based; `1 2\nnonsense\n` → 13 for both) — the existing `N-1` byte math still applies |
| exit status | still non-zero (`Unrecoverable error, exit code 1`) |
| scope | only **uncaught** errors reach it; `{ 1 2 ] } stopped` does not (verified) |

Consequences for L3: the human-readable block (`Error: /x in y`, `Operand
stack:`, …) no longer has to be scraped. A handler can print one prefixed line
carrying error name, offending token, position and operand stack, which
`gsParsers.ts` can parse as data instead of prose.

### 2.1a Interference from the validated program

`errordict` is an ordinary writable dictionary, and the program being validated
runs in the same interpreter. **No PostScript-level hook is unremovable**, so
the design is "harden what can be hardened, classify what cannot, never invent a
position". Every row below was executed on gs 10.08.0 with the production
argument order (`-c handler -f file -c sentinel`):

| Program does | gs result | Reaction |
|---|---|---|
| `/print {…} def`, `/flush {} def` | no effect — `bind` resolved those names to operator objects before the file ran | attribution unchanged (verified: `position` still exact) |
| `/systemdict 5 def` | no effect — the handler never looks `systemdict` up at run time | attribution unchanged |
| `/errordict 5 def` | no effect — the handler was `put` into the real `errordict` before the file started | attribution unchanged |
| `/$error 5 def` | **gs itself dies**: `typecheck in get` → `Unexpected interpreter error -20`, exit 255. The default handler dies identically, so this is a gs-level fragility, not something the hook introduced | classified `crash`: reported as "the interpreter failed", no fabricated position |
| `errordict /handleerror {…} put` | hook replaced; no structured line; exit 1 | classified `error-unattributed`: "failed but no position was reported", pointing at end of document |
| `errordict /unmatchedmark {…} put` | the per-error handler runs *instead of* `handleerror`; if it returns, gs is left in an undefined state and usually raises a **second** error (`/typecheck`) | attributed to the second error — documented limitation, position is still near the real culprit |
| `quit` (anywhere before the end) | exit 0, sentinel absent | classified `incomplete`: the run does **not** count as gs-verified, so L0 warnings stay |
| `(%stdout) (w) file closefile` | gs raises `/invalidfileaccess` itself under the default SAFER | normal attribution |
| prints a literal `===GS-ERROR=== …` line | lands in the same stdout stream as the real report | per-run nonce in every marker: forged lines do not parse |

The hook itself is built to survive rebinding: `//$error` is resolved at **scan**
time (before the file runs) and the dictionary object is spliced into the
procedure — verified that gs reuses the same `$error` object for every error, so
the snapshot stays live; all operators are resolved by `bind`; no named locals
are created in userdict.

Rejected alternative — wrapping the file in `stopped` (`{ (file) run } stopped`):
it is genuinely tamper-proof because `errordict` is never consulted, but it also
prevents the program's own error handlers from running, which changes what is
being validated (a file that handles `/rangecheck` and continues would be
reported as failing). It also needs `run` + `--permit-file-read` and would
re-execute the file if used as a second pass. Recorded here as a deliberate
non-goal, not as an oversight.

### 2.2 `-dESTACKPRINT`

**Verified**: changes the execution-stack dump from one wrapped line to one item
per line, with markers such as `--%interp_exit--`, `.runexec2`, `-file-`,
`--]--`, `null`. `-dNOESTACKPRINT` has **no** effect in this build (the stack is
printed either way). Useful for the output channel, not for parsing.

### 2.3 `-sstdout=%stderr`

**Verified**: with this flag *everything* — PostScript `print` output and the
error block — goes to stderr and stdout stays empty (`2>&1 >/dev/null` shows the
whole transcript). Documented in `Use.html` as the recommended way to keep
messages out of an output stream. Only worth it if stdout is reserved for
machine-readable lines.

### 2.4 `-c` preamble before `-f` (and a `-c` sentinel after it)

**Verified ordering**: `gs … -c "…" -f file.ps` installs state before the file
runs, and `-c` binds operators and makes `systemdict` read-only first. This is
how a handler/probe can be injected **without appending text to the snapshot**
(today the residue probe is appended to the temp copy).

`-c` arguments are processed in order, so a **second** `-c` after `-f` runs only
when the file reached its end. Verified on 10.08: clean file → sentinel printed;
`1 2 ]` → absent, exit 1; `quit` mid-file → absent, **exit 0**. That makes
"exit 0" falsifiable: without it, a `quit` on line 3 looks exactly like a fully
validated document. L3 uses this to distinguish `clean` from `incomplete`.

### 2.5 `%ram%` — in-memory file

**Verified**: `(%ram%probe.ps) (w) file` + `writestring` + `closefile`, then
`readstring` and `run` all work (the run left the stack at depth 4 for
`[ 1 2 3`). **But** an error inside a `%ram%` file prints no
`Current file position` (verified), i.e. it is not usable where offsets matter.
Good for scratch data, not for source snapshots.

### 2.6 Argument file, search path, `run` under SAFER

- `@filename` — **documented** (`Use.html`): the whole command line can live in a
  file, which sidesteps length limits for long `-c` preambles.
- `-I<dirs>` — **documented**: prepends library directories, so a probe library
  can be `run` by name.
- `run` of a sibling file — **verified**: under default SAFER it fails with
  `/invalidfileaccess`; without SAFER but with a bare name it fails with
  `/undefinedfilename` (the library path, not the process cwd, is searched);
  with an absolute path plus `--permit-file-read=<abs file>` it runs and the
  resulting `$error /position` is relative to that file. This is exactly why L3
  feeds one merged temp file instead of `run`-ing the real inputs.

### 2.7 `-Z` debug switches

**Verified**: `-Z@` in this release build produces no extra output and no error
— it is accepted and ignored. The `-Z` family is a DEBUG-compile feature
(**documented**, not reproducible here). A debug build of gs could dump stacks
per operator; shipping one is not an option for an extension.

## 3. Language-level introspection (PostScript, no new flags)

| Facility | Verified behaviour | Possible use |
|----------|--------------------|--------------|
| `count`, `counttomark` | see `mark-diagnostics.md` | residue probe (already used) |
| `$error` / `errordict` | see 2.1 | structured errors |
| `.fileposition` | returns a byte offset, works on temp files, missing for `%ram%` | positions |
| `dstack`, `systemdict`, `userdict` enumeration | plain dict traversal | could inform L2 dictionary scoping |
| `vmstatus` | returns three integers | nothing useful |
| `devicenames`, `setpagedevice` | device probing | nothing useful |

**`known` / `where` are not existence proofs.** `systemdict /pdfmark known` is
`false` while `systemdict /pdfmark get type` is `operatortype`, and
`[ /Title (x) /DOCINFO pdfmark` does consume the mark (`count` → 0). The reason
is that gs resolves some operators through its own lookup path rather than a
visible entry, so a probe that only asks "is the name in this dictionary" gives
both false negatives (a real operator reported missing) and false positives
(a user-level alias reported as built in). The rule that already holds for
PLRM reading holds here too: **only behaviour counts.** Test with
`mark 1 2 3 <op> count` (or a real call) and read the result, never `known`.

Corollary found while auditing the mark tables: `clearstack` is *absent* from
gs 10.08 (`1 2 3 clearstack` → `/undefined in clearstack`), so it must not sit
in any default operator table. `clear` is present and empties the stack
(`1 2 3 clear count` → 0).

## 4. What does not exist (checked, so we stop looking)

- **parse-only / dry-run mode** — `-h` lists none; an invented `-dPARSEONLY` is
  ignored and the file still executes (verified). Every run has side effects.
- **AST or token dump** — no such output mode; `token` is a language operator
  with the `//` limitation described in `mark-diagnostics.md`.
- **structured diagnostic format** — nothing built in; `$error` is the raw
  material, the JSON has to be written by us.
- **provenance for marks or delimiter operators** — `mark mark eq` is true
  (verified); no interface, including `gsapi`, can say which source line pushed
  a mark.
- **interpreter callbacks from PostScript to the host without embedding** —
  callouts (`gsapi_register_callout`) are an in-process API; the CLI has no
  equivalent.

## 5. Recommendations

| # | Item | Value | Cost | Verdict |
|---|------|-------|------|---------|
| R1 | L3 reports errors via a `-c`-injected `errordict /handleerror` that prints one prefixed line (`errorname`, `command`, `position`, `ostack`) | removes prose scraping; adds the operand-stack snapshot; same position semantics | ~1 module + tests; keep the current parser as fallback for gs builds without the handler | **done** — plus the hardening and run classification in §2.1a |
| R2 | Keep the `counttomark` residue probe | a clean run raises no error, so no handler fires | none | keep |
| R3 | `-dESTACKPRINT` for the output channel | readable stack in the report | one flag | optional |
| R4 | `-sstdout=%stderr` | clean stdout for machine lines | one flag | only with R1 |
| R5 | `gsapi_*` embedding via FFI | persistent session, step feeding, in-process capture | native dependency + per-platform gs library | **not now** |
| R6 | `-c` completion sentinel after `-f` | makes `exit 0` falsifiable (`quit` vs. really finished) | one argument | **done** |
| R7 | `stopped`-wrapped `run` as a tamper-proof error channel | immune to `errordict` rewrites | bypasses the program's own error handlers (semantic drift), needs `permit-file-read`, re-executes on a second pass | **rejected**, see §2.1a |

R1 is the only change that buys accuracy rather than convenience: `ostack` is
the interpreter's own snapshot of the operands at the failure point, which is
strictly better than inferring them from the printed block.
