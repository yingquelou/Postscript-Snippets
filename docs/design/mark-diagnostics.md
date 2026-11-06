# Design: Mark-Aware Diagnostics (issue #2)

Status: implemented (1.1.9) · Scope: language server static analysis + optional dynamic validation
Tracking: [#2 — false "Unclosed array" on `[ ... pdfmark`](https://github.com/yingquelou/Postscript-Snippets/issues/2)

## Problem

`[ /Title (x) /DOCINFO pdfmark` and `[ 1 2 3 cleartomark` are reported as
"Unclosed array"; `mark 1 2 3 cleartomark` as "Orphan mark operator". Both are
valid PostScript: `cleartomark` and `pdfmark` pop the operand stack down to and
including the nearest mark. The symbol builder treats `[`/`<<`/`mark` as
containers that can only be closed by `]`/`>>`, so any mark-based construct
produces a false diagnostic and its content is dropped from the outline.

Root causes, in three independent layers:

1. **Semantic** — the symbol stack has no notion of *mark-consuming operators*.
   `pdfmark`/`cleartomark` fall through to the default branch (pushed as
   values), leaving the mark group on the stack; `finalizeStack` then warns.
2. **Lexical** — resolved by inspection, not a bug: the lexer must follow the
   Ghostscript tokenizer exactly. In gs, `/]` scans as **two tokens** — an
   empty literal name (`/` followed by a delimiter; `length` 0) plus the `]`
   delimiter. The current `LiteralName` pattern (`/` + zero-or-more
   non-delimiter chars) already reproduces this. Consequence: the
   "Mismatched array end token" seen on `/]` input mirrors gs behavior and is
   kept; no lexer change is planned.
   - Writing a *name* whose value is `]` is impossible at source level; it must
     be constructed. gs 10.08.0 distinguishes the two constructions:
     `(]) load` yields the `]` **operator** (prints `--]--`), while `(]) cvn`
     yields a **literal** name that is pushed, not executed, until `cvx`.
   - Hence `/] load` is simply wrong, however often it circulates: gs rejects
     `/pdfmark /] load def` with `/unmatchedmark in --]--`, whereas
     `/pdfmark (]) load def` and `/pdfmark (]) cvn cvx def` both bind
     `pdfmark` to `]` (verified: `mark 1 2 3 pdfmark` → one array).
3. **Engineering** — mark construction may span files (`[ ...` in `a.ps`,
   `1 2 3 ]` in `b.ps` is legal Ghostscript: files are stream fragments on a
   global interpreter). Per-file pairing checks are the wrong granularity, and
   the analyzer currently has no notion of a build unit at all.

## Layered solution

| Layer | What | When |
|-------|------|------|
| L0 | Single-file mark-aware static analysis + config escape hatch | every keystroke |
| L1 | Composition flow: analyze the merged build stream, map diagnostics back per file | on config/dependency change |
| L2 | Workspace symbol index (name → definition), enables cross-file resolution | background |
| L3 | Ghostscript dynamic validation of the real build command | manual / on-save |

Principle: the static layer stays (instant, full coverage, structural), the
config keys are a **mitigation** for dynamic rebinding
(`/pdfmark (]) load def`, `{cleartomark} bind def`, conditional `def`s), not a
complete solution. L3 is the final semantic arbiter.

### L0 — mark-aware symbol stack

- `[`, `<<`, `mark` become a single unified *mark* stack entry carrying a
  `kind` tag (`array` / `dict` / `mark`). Error messages are unified;
  outline rendering keeps the kind.
- New settings (namespace `postscript.parser`):
  - `postscript.parser.markConsumingOperators` — names that pop the stack
    down to and including the nearest mark. Default
    `["cleartomark", "pdfmark"]`. Content collected since the
    mark is attached to the consuming operator's symbol, so the outline keeps
    it. `packedarray` is deliberately **not** a default: its signature is
    `any0…any(n-1) n packedarray` — an explicit count, no mark involved — and
    the mark form gs also accepts (`mark 1 2 3 packedarray` → one packed
    array, count 1) is a compatibility behaviour, not what the operator means.
    A project relying on that form declares it via the setting; unconfigured,
    the leftover mark is reported and L3 grading settles it. `array` is not a
    consumer either: it takes its size from an integer operand (gs-verified).
  - `postscript.parser.markSuspendingOperators` — names that discard pending
    marks silently. Default `["clear"]`. After one of these, earlier marks no
    longer warn.
    `clearstack` (`/clearstack systemdict exch known` is false in 10.08;
    `1 2 3 clearstack` → `/undefined in clearstack`) is a Level 1 legacy name
    that gs never implemented, so it is **not** in the default table: an entry
    that can never match is worse than no entry, because it implies support
    that does not exist. Add it yourself if you target an interpreter that
    has it.
- Matching rules: match against **executable name tokens only**; `/pdfmark`
  (literal name) does not match. `//name` does match: an immediate name denotes
  the same operator as `name`, so the lookup strips the `//` prefix and one
  table entry covers both spellings. gs 10.08 verified: `mark 1 2 //cleartomark`
  leaves `count` 0, `mark /a 1 //.dicttomark` yields a dict,
  `[ /Title (x) /DOCINFO //pdfmark` consumes the mark — all identical to the
  bare forms (including `pdfmark`'s `/typecheck` on a non-key-value operand
  stack, which the spelling does not change). A bare `//` (empty name)
  is a lexical error and matches nothing, so it is never treated as a consumer.
  `counttomark` is read-only and deliberately not in the default consuming
  table.
- Closing rules follow the untyped mark of gs rather than a bracket grammar:
  - `[`, `<<` and `mark` push the **same** mark entry; the `kind` tag is a
    rendering hint only. gs confirms they are one object: `([) load` and
    `(<<) load` both yield `--mark--`.
  - Any closer pops to the nearest mark regardless of what opened it; the
    **container type comes from the closer**, not the opener — `]` → array,
    `>>` → dictionary. gs 10.08 verified: `[ 1 2 >>` is a dict, `<< /a 1 ]`,
    `mark 1 2 ]` and `mark /a 1 >>` are what their closer says. Therefore no
    open/close "type mismatch" diagnostic exists by design; such containers
    are labelled `markedArray` / `markedDictionary` in the outline.
  - The only structural error is "no mark in scope" (`]`/`>>` on an empty
    stack), which mirrors gs `unmatchedmark`; `[ 1 2 ] >>` is reported at the
    `>>` for the same reason.
  - `{`/`}` are **not** aliasable — `({)` / `(})` are undefined in gs. `}`
    only pairs `{`, and mark consumption still stops at a procedure boundary.
- Aliasing: `]`, `>>`, `[`, `<<` *are* values in gs (`(]) load` → `--]--`,
  `(>>) load` → `-->>--`, `([)`/`(<<) load` → `--mark--`), so projects do bind
  `/close (]) load def`. The static layer does not follow `def` / `load` /
  `bind` / `put` / `exec`; an alias is honoured only when its **name** appears
  in the two operator tables. Everything else falls through to L1 (downgrade
  to hint) and L3 (interpreter as arbiter).
- A custom closer may also consume **more than one** mark: `/dupclose { ] ] }
  def` closes two (`mark 1 mark 2 dupclose` leaves one nested array; the
  following `counttomark` raises `unmatchedmark`). Which body `dupclose`
  denotes, and what the stack holds when it runs, is rebinding — undecidable
  here by the same criterion as every alias — so the L0 answer stays
  declarative: list the name in `markSuspendingOperators`, which suspends the
  pending-mark check from that point on (the suspending table drops to the
  procedure boundary, the `clear` discipline). Unconfigured, the leftover
  marks are still reported, but every one of these diagnostics is
  `isWarning`, so a clean gs run grades them down to PS014 hints. The built-in
  consumers, by contrast, are measured to close exactly one mark:
  `mark mark 1 2 cleartomark` leaves the outer mark on the stack (`count` 1,
  `counttomark` 0), and `mark mark 1 2 pdfmark` is a typecheck error.
- Consumption is limited to the current procedure scope: a mark opened before
  `{` is not consumed inside a procedure body, mirroring gs's per-procedure
  operand-stack discipline for structural analysis purposes.

#### Configuring around local conventions

The two tables are the supported answer to "in this project `error` also closes
a mark". gs' own pdfwrite implementation (the 8335-line `ghostscript.ps` from
the gs distribution) is the reference case: 62 warnings out of the box, nearly
all of them the `mark (msg) //error exec` idiom, where the consumer is a
procedure defined in the same file (`/error { … cleartomark … } def`) or an
internal operator (`/.dicttomark {>>} bind def`). Two entries remove them:

```jsonc
// .vscode/settings.json — workspace scope
"postscript.parser.markConsumingOperators": [
  "cleartomark", "pdfmark", "error", ".dicttomark"
]
```

Plain names only: `//error` hits the same entry, because an immediate name is
the same operator. Measured on that file: **62 → 5** warnings (the two entries
cover the `//error` idiom entirely; `packedarray` contributes nothing there).
The five that
remain are the shapes this layer does not model on purpose — `mark` used as an
`eq` operand, a procedure body that is nothing but a delimiter (`{>>}`), and a
mark handed to an unknown caller through the operand stack. All five are
settled by `PostScript: Validate with Ghostscript`: the file runs clean with
residue 0, so they become hints (PS014).

### L1 — composition flow analysis (implemented)

- Reuses the merge order from `compilePostscript.ts`
  (`globalDependencies → workspaceDependencies → target inputs → current file`;
  buildArgs are process arguments, not stream content) to concatenate
  dependency fragments into one analysis stream, runs the same mark-aware
  symbolBuilder over it, and maps fragment offsets back to individual files
  (`src/language-server/compositionAnalysis.ts`).
- Cross-file mark constructs that balance in the merged stream are downgraded
  to *hint* (PS012, "balanced in the build context") — visible, not silent.
  Errors are never downgraded.
- Only documents declared in `postscript.config.json` get composition
  analysis (`analysis unit = build unit`); everything else keeps pure
  single-file L0 diagnostics. The merged stream is cached by doc version +
  dependency list + dependency mtimes + parser config version.
- Honest limits: runtime-conditional execution order (`if` bodies that `run`
  different files) and `gs -c` inline chunks are outside the config model;
  those belong to L3. Files declared only as dependencies (not targets) are
  still analyzed single-file when opened directly.

### L2 — workspace symbol index (implemented)

Name → (file, range) index backing go-to-definition and workspace-symbol
search (`src/language-server/workspaceIndex.ts`).

- Definitions are extracted at token level: a literal name `/x` bound by a
  `def` at the same nesting depth; pending keys are tracked **per depth**, so
  `/outer { /inner ... def } def` yields both. `mark` does not clear a pending
  key (it does not consume literal names — `/a mark 1 cleartomark 2 def` is
  runtime-valid).
- Offsets are normalized to exclusive ends (chevrotain's `endOffset` is
  inclusive of the last character — same convention fix applied to the
  cursor-token hit test in `onDefinition`).
- Index is lazy (first request), mtime-aware per file, kept in sync via
  watched-file events (create/change/delete) and editor saves; skips
  `node_modules`/`.git`/`out`/`dist`/... and caps file count/size.
- `onDefinition`: dirty-buffer definitions win over disk index; returns all
  matching locations. `onWorkspaceSymbol`: case-insensitive substring query,
  procedures as SymbolKind.Function, values as SymbolKind.Variable.
- Best-effort by design: no execution semantics; conditional definitions and
  dictionary scoping (`begin`/`end`) are out of scope for the index layer.

## Roadmap

- L0–L3 all implemented; L3 is a manual command that validates the **build
  unit**, reports errors against the owning file, and feeds its verdict back
  into L0 (PS014) for the exact document version it ran on. L1 upgrades
  structural warnings to hints inside the declared analysis unit.
- Deferred: on-save L3, dictionary-scope-aware resolution on top of L2,
  build-trace consumption as the first-source project model, and a PS-side
  stepping interpreter.
- Out of reach by construction — with the reason for each — is listed in
  *Irreducible limits* below. Nothing in that table is planned work; it is the
  boundary of the approach.

### L3 — Ghostscript validation (implemented)

- Command `PostScript: Validate with Ghostscript`
  (`postscriptsnippets.validateWithGhostscript`, manual; on-save optional
  later — never per-keystroke: side effects). Diagnostics land in the
  `postscript-gs` collection with code PS013.
- **Input is the build unit, not the buffer.** When `postscript.config.json`
  declares the file, gs executes the merged dependency stream
  (`buildCompositionStream`, same order as `compilePostscript`). Running a
  single file that takes part in a cross-file construct would always fail
  with `/unmatchedmark` and turn the arbiter into a false-positive source
  (verified: `a.ps` = `[ /Title (x)`, `main.ps` = `1 2 3 ]` → single-file run
  errors, merged run exits 0). Fragments are joined with a newline so the
  last token of one file can never fuse with the first token of the next.
- Error attribution: gs's byte position maps back through the fragment table
  (`locateFragmentOffset`), so an error in a dependency is reported on that
  dependency's file, with `— reported in <name>` appended to the message.
- Diagnostics path: **temp-file snapshot** of the buffer (LSP text → temp file
  → gs file argument), so gs reports byte offsets 1:1 against the buffer text.
  stdin is reserved for the interactive console, where the client already
  keeps a chunk→source ledger (PS_EVAL protocol).
- gs findings (gs 10.08, verified):
  - default error handler prints `Current file position is N` **only for
    seekable files** — stdin silently omits it; a custom `errordict` handler
    using `.fileposition` restores machine-readable positions on both inputs.
  - **channel**: the `Error: /<errorname> in <command>` block goes to
    **stdout**; stderr only carries the final `Unrecoverable error` line.
    Parse the combined output.
  - offset semantics: `N` is **1-based** and points AT the terminating
    whitespace following the offending token ("foo pop\n" with foo at byte 0
    reports 4 = the space). Convert the 0-based byte index `N-1` to a UTF-16
    char offset (snap to UTF-8 boundary for multibyte content); the token's
    exclusive end coincides with that whitespace char.
  - the `offending command` name is kept as a second-pass anchor.
- v1 collects the first error only (continuing after an unhandled error can
  cascade stack pollution into noise).
- **Mark-residue probe**: gs never complains about an *unclosed* opener (a
  lingering mark is not an error), so "clean exit" alone cannot distinguish
  `[ 1 2 3 ]` from `[ 1 2 3`. The validated stream gets one appended probe
  (never the user's buffer):

  ```
  { counttomark (===GS-RESIDUE===) print == } stopped
  { (===GS-RESIDUE=== none) print flush } if
  ```

  `counttomark` answers "how much content sits above the final mark"; the
  `stopped` branch converts "no mark at all" into an explicit `none`, so
  `parseResidueOutput` returns a number, `0`, or `undefined` (probe never ran,
  e.g. the file ends with `quit`). Verified with gs 10.08: `[ 1 2 3` → `3`,
  `[ 1 2 cleartomark` → 0, `1 2 3` → 0.

### L3 — run classification (implemented)

A single gs run yields more states than "pass / fail", and collapsing them
would either hide a real failure or invent a position. `classifyGsRun`
(`gsParsers.ts`) keeps them apart:

| Outcome | Evidence | Consequence |
|---|---|---|
| `clean` | exit 0 **and** the `-c` sentinel after `-f` ran | may downgrade L0 warnings (PS014) |
| `incomplete` | exit 0, sentinel absent → the program called `quit` before the end | **not** verified; L0 warnings stay, status bar says so |
| `error` | structured report from the `-c` handler | PS013 at the reported byte, mapped to the owning fragment |
| `error-text` | no report, but the default `Error: /… in …` + `Current file position` block is present | PS013 with the legacy parser |
| `error-unattributed` | non-zero exit, no machine-readable error at all (the program replaced `errordict /handleerror`) | PS013 "failed but no position was reported" at end of document — never a guessed line |
| `crash` | exit ≠ 0/1 or `Unexpected interpreter error` (gs died outside the PostScript error machinery, e.g. the program redefined `$error`) | PS013 at the document start, message says the interpreter itself failed |

Hardening of the hook and the full verified interference matrix live in
`gs-interfaces.md` §2.1a. Two points belong here because they shape what L0 may
trust:

- Every marker carries a **per-run nonce**, so a `===GS-ERROR===` line printed
  by the validated program cannot be mistaken for the handler's report.
- `clean` requires the completion sentinel, not just exit 0: gs returns 0 for a
  program that `quit`s on line 3, and treating that as "verified" would silence
  structural warnings for text the interpreter never reached (verified).

### L3 → L0 feedback (implemented)

A clean gs run is stronger evidence than any static guess: the interpreter
resolves aliases (`/close (]) load def`), `load`, `bind` and conditional
`def`s that the token-level layer deliberately does not follow. The verdict is
therefore pushed back to the language server:

- Client sends `postscript/gsVerified { uri, version, clean, residue }` after
  every run; the server records it per **document version** and immediately
  revalidates that document. Any edit bumps the version and the verdict
  expires — a stale run can never suppress a diagnostic for text gs has not
  seen.
- In `validateTextDocument`, a *structural warning* (PS009) on a verified
  version becomes a hint (PS014) whose message says either "gs-verified: the
  file runs" or "gs ran clean but left N operand(s) above the final mark"
  (residue > 0 keeps the warning visible but stops pretending it is a
  parse-level guess). Errors are **never** downgraded — same rule as L1.
- Precedence: gs verdict (PS014) > composition balance (PS012) > single file.
- Division of labour this buys: gs settles *closers* (a `]`/`>>` with no mark
  is a hard error with a precise position, aliases included), while the
  static layer keeps owning *openers* — an unclosed container has no
  provenance at run time (`mark mark eq` is `true`; every mark prints
  `--mark--`), so only the token stream can point at the offending line.

## Irreducible limits — and why each one stays

The layered design closes the false positives it can. What remains is not "not
implemented yet"; it is blocked by one of three causes, tagged per item:

- **[lang]** the answer is a runtime value — deciding it in general means
  running the program;
- **[interp]** the interpreter knows the fact but does not expose it (no
  provenance, no parse-only mode);
- **[policy]** solvable, but the cost (execution risk, latency, duplicated
  interpreter) is worse than the residual noise.

| # | Limit | Cause | What the product does instead |
|---|-------|-------|-------------------------------|
| 1 | Delimiters produced from runtime values are invisible in the text | lang | name tables + L3 for code gs actually ran |
| 2 | `token`-level replay cannot replace execution | interp | the static token stream (same information, instant) |
| 3 | An unclosed opener cannot be located at run time | interp | static layer owns openers; the probe reports depth only |
| 4 | gs has no parse-only mode | interp | manual command, snapshot, timeout, appended probe |
| 5 | A dynamic verdict expires on the next edit | policy (from 4) | version-keyed PS014; static verdict returns immediately |
| 6 | Code gs never ran has no verdict | lang | static hint, explicitly non-authoritative |
| 7 | A file outside `postscript.config.json` cannot be judged as a fragment | policy | single-file truth + a declarative way out |
| 8 | The symbol index has no dictionary model | policy | best-effort navigation, never used to suppress a diagnostic |
| 9 | The validated program can replace `errordict /handleerror`, so the structured report can disappear | lang | hardened hook + run classification; a failure without a position is reported as such, never guessed |

### 1. Runtime-valued delimiters [lang]

The same text can be balanced or not depending on earlier `def`s, so no
text-level rule can decide it. gs 10.08, four identical shapes:

| Repro | Result |
|-------|--------|
| `/f (]) cvn cvx def` then `mark 1 2 //f type` | `arraytype` — `//f` is resolved by the scanner, so the `]` operator runs |
| `/g (]) cvn def` then `mark 1 2 //g type` | `nametype` — same text, the literal name is pushed instead |
| `/o ([) load def` then `o 1 2 ] type` | `arraytype` — an alias opened the mark |
| `/c (]) load def` then `o 1 2 c type` | `arraytype` — an alias closed it |

`//name` is the sharpest case: the reference is replaced by its **value before
execution starts**, so neither a static pass nor a token replay ever sees the
indirection. Following `def`/`load`/`bind` instead would still stop at the first
`put` with a computed key, `exec` in a loop, or `save`/`restore`. That is why the
operator tables are exact-name tables, and why L3 exists.

### 2. `token` replay cannot substitute for execution [interp]

A dynamic lexer built on `token` was the first approach tried here; gs 10.08
shows it cannot work, for four independent reasons:

| Repro | Result | Consequence |
|-------|--------|-------------|
| `/f 42 def` then `(//f 1 2) token` | `42` | `//` is evaluated by the scanner — there is no switch to keep it symbolic |
| `(//undefinedName 1) token` | `/undefined` | the token stream breaks, so the replay cannot continue past such a line |
| `mark mark eq` / `(]) load (]) load eq` | `true` | mark and `]` are plain objects with **no provenance**: a caught closer cannot be attributed to an opener, nor a closer to a line |
| `{ 1 2 } 0 get type` | `integertype` | the stream carries values, not execution intent; whether an element runs depends on the call path |

Restoring `//` by rewriting the source would mean writing a second tokenizer
whose semantics drift from gs's. A token replay is therefore exactly the static
layer already in use — with extra latency and extra failure modes.

### 3. Unclosed openers have no runtime location [interp]

gs does not treat stack residue as an error, by design (files are stream
fragments; the next file may close the construct). `[ 1 2 3` at EOF exits 0 with
no message.

The residue probe narrows this but cannot localise it:

| Repro | Probe (`counttomark`) | Full depth (`count`) |
|-------|----------------------|----------------------|
| `[ 1 2 3` | `3` | `4` |
| `[ [ 1 2` | `2` | `4` |

`counttomark` measures only above the **nearest** mark — two nested openers
collapse into one number — and no mark carries a source position (see the
`mark mark eq` row above). So PS014 can say "gs ran clean but left N operands
above the final mark" and can never say "line X is unclosed". Locating openers
stays a token-stream job, which is precisely what L0 already does.

### 4. gs has no parse-only mode [interp]

There is no syntax-check-only switch: `gs -h` (10.08.0) offers none, and an
invented `-dPARSEONLY` does not stop execution either — a file that only prints
still prints (`-dPARSEONLY` is not rejected, it is simply ignored). Every mode
executes: `-dNODISPLAY` still honours `run`, can write files, can block on
input. Dynamic validation is therefore a **manual command**: a temp snapshot, a
20 s timeout, and a probe appended to the copy (gs 10.x already runs with SAFER
unless `-dNOSAFER` is passed, so no extra flag is needed) — never per keystroke.

### 5. A dynamic verdict expires on the next edit [policy]

A run is evidence about the exact bytes gs saw. Keying the verdict by document
**version** is the only sound option: a stale clean run must never silence a
real error. Consequence: right after the first keystroke the strongest evidence
is gone and the static verdict returns until the next run. This is deliberate —
the alternative (persisting a verdict across edits) trades a real error for a
cosmetic one.

### 6. Code gs never ran has no verdict [lang]

Untaken `if`/`ifelse` branches, procedures never called, `stopped`-guarded
regions that did not fail, and files outside the build order produce no
evidence at all. Those regions keep static structural hints, which may be wrong
in either direction. The hint is labelled as a static reading, never as a gs
conclusion.

### 7. Files outside the config cannot be judged as fragments [policy]

For a file not declared in `postscript.config.json`, `[ ...` is genuinely an
unbalanced program — the `unmatchedmark` report is a true statement about that
file. Nothing distinguishes a deliberate fragment from a typo without the build
model, and guessing from file names would create the false positives this whole
design removes. The way out is declarative: declare the unit.

### 8. The symbol index has no interpreter model [policy]

L2 matches a literal `/x` and the `def` that binds it at the same nesting depth.
`begin`/`end` dictionary scoping, conditional `def`s, `put` with a computed key
and `save`/`restore` are outside the model. Navigation is best-effort and its
output is never used to suppress a diagnostic — one direction only.

### Considered and not planned

- **Literal alias patterns in L0** (`/x (]) load def` → treat `x` as a closer).
  Dropped: L3 settles those cases exactly, so a pattern table would add a second
  source of confidence for the same subset and still miss every non-literal
  binding.
- **Resolving user-defined closers automatically** — registering a
  `/name { … cleartomark … } def` body in the consuming table, treating `mark`
  as an `eq` operand, or reading a `{>>}` body as a macro. Rejected as a class
  by one criterion: a static change may not assume *which object a name
  denotes*. That is name resolution — scope, `def` order, conditional branches,
  `load`/`exec`, runtime rebinding — and it is undecidable at this layer; the
  tables are the explicit declaration and L3 is the arbiter. The cost of the
  approximation is measured: adding `eq` as a consumer turns the legal
  `[ 1 (a) (b) eq ]` (gs: `[1 false]`, exit 0) into a diagnostic *and* silences
  a genuine leftover mark, because consumption pops the nearest mark without
  knowing where it came from — on `ghostscript.ps` the count went 5 → 6, with
  two false positives on `]cvx`. The `//name` normalization is not an exception
  to the criterion: it assumes nothing about the object, only that two
  spellings of one token denote one token.
- **`[` ↔ `pdfmark` cross-highlight** (issue #2, "cursor on `[` highlights the
  closer"). Not planned, and not a gap this layer can close: `colorizedBracketPairs`
  in `language-configuration.json` pairs *bracket tokens* only, which is why
  `mark` is listed there (`mark … ]`, `mark … >>`) while `pdfmark`,
  `cleartomark` and their aliases are not — they are ordinary
  name tokens, not scope delimiters, and VS Code highlights a pair by matching
  token *text*. Listing `pdfmark` would therefore also light up a literal
  `/pdfmark`, a procedure named `pdfmark` that consumes nothing, or the same
  word in a string. A server-side `documentHighlight` provider has the mark
  stack and could do better, but only for names it can classify — which is
  exactly the dynamic-binding problem in limit 1. It would highlight the cases
  the outline already shows and stay silent on the ones users ask about.
- **Source rewriting before `token`** — a second tokenizer with semantic drift
  (see limit 2).
- **Automatic execution on every keystroke** — side effects, hangs (limit 4).
- **A PS-side stepping interpreter** (`token` + `stopped` + `errordict`
  maintaining a real stack). Not impossible: it is the one design that could
  attribute a closer to an opener, because *it* controls the stepping. Deferred
  rather than rejected — it would duplicate the debugger's token stepping, carry
  the same execution risk as L3, and must reimplement gs's error recovery to
  stay in sync. That work belongs to the debugger/tokenizer line, not to the
  linter.

## Ground rule: PostScript is verified, never assumed

PostScript text that ships in this repository — `.ps` files, doc examples,
test fixtures, generated preambles — is run through the interpreter before it
is trusted. Documentation and design notes are **not** a source of truth for
gs behavior; PLRM reading is a hypothesis until gs confirms it.

Verification harness (gs 10.08.0, `-q -dNODISPLAY -dBATCH -dNOPAUSE`):

| Repro | Verdict |
|-------|---------|
| `/pdfmark /] load def` | `/unmatchedmark in --]--` — `/]` is an empty name + `]` |
| `/pdfmark (]) load def` | ok — binds `pdfmark` to the `]` operator |
| `/pdfmark (]) cvn cvx def` | ok — binds the executable name `]` |
| `(]) load` alone in code position | executes `]` → `/unmatchedmark` without a mark |
| `/x / def x length` | `0` — proves `/` + delimiter is an empty name |
| `mark 1 2 3 packedarray` | 1 packed array, mark consumed — gs behaviour; not a default consumer (signature takes an explicit `n`) |
| `mark 1 2 3 array` | mark survives (`array` takes an int size) |
| `[ 1 2 3` (unclosed) | silent, stack residue is not an error |
| `1 2 3 ]` | `/unmatchedmark` — hard error |

Three harnesses enforce this, all optional when gs is missing (they print
`SKIP` and exit 0), and CI runs the aggregate `npm run verify` after the unit
tests so the table above cannot silently rot:

- `npm run verify:parity` (`scripts/verify-mark-parity.js`) — re-runs the
  semantic cases above and fails when the language server and gs disagree.
- `npm run verify:ps` (`scripts/verify-ps-files.js`) — executes every `.ps`
  file under `ps/`, `pslib/` and `docs/design/prototype/` with gs; a non-zero
  exit or an `Error:` block fails the run.
- `npm run verify:trace` (`scripts/verify-l3-trace.js`) — end-to-end L3 and
  build-trace runs: the exact gs command lines from `validateWithGhostscript`
  and `buildTrace`, including the byte→char offset mapping.

The two script-level harnesses that need TypeScript modules bundle them from
`src/` with esbuild (`scripts/loadSrc.js`) instead of requiring `out/`: a
`npm run package` starts with `clean:out`, so depending on tsc emit made the
verifier pass or fail according to which command ran last.

Neither harness reads markdown. The inline repros in this document were run by
hand on 10.08.0 when written (their printed output is quoted as-is); if you
re-use one, re-run it.
