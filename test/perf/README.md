# Core performance

From this repository, after installing development dependencies:

```sh
bun run perf
bun run perf --list
bun run perf --filter 'core/layout/'
bun run perf --smoke
bun run perf --json > /tmp/core-perf.json
```

The workspace also exposes `bun run perf:core`. Its `bun run perf` command runs
core, math, and maps sequentially with the same options and one combined report.

## Workloads

The suite uses deterministic inputs at fixed sizes:

- 100 and 1,000 positioned rectangles.
- Alternating horizontal and vertical stacks with 243 leaves and padded boxes.
- A wrapping stack with 200 flexible boxes and maximum widths.
- A 100-cell grid of text and a long paragraph with 40 bold spans.
- Line and scatter plots with 2,000 samples, axes, labels, and grid lines.
- A network with 64 labeled nodes and 112 edges.
- A JSX grid with 100 cells, including parsing and evaluation.

Case names describe what one measured operation includes:

| Prefix | Measured work |
| --- | --- |
| `core/construct/` | Build a new element tree, including prop normalization and snapshots. Fixed plot data is prepared outside timing. |
| `core/layout/` | Lay out an existing tree with a new `LayoutPass` and a warmed font provider. Includes pass construction, measurement, fitting, and preparation. |
| `core/svg/` | Serialize an already laid-out viewport fragment to SVG. |
| `core/evaluate/` | Parse and evaluate JSX using an existing evaluator; no layout. |
| `core/render/` | Construct or evaluate the tree, then lay out and serialize with a new pass and warmed fonts. |
| `core/cache/` | Repeat the exact same layout query on a populated pass. Measures a cache hit. |
| `core/fonts/` | Construct a fresh pass and font provider, then perform the first text layout. Includes lazy font loading. |

`paragraph-resize-3-widths` is one batch of three layouts at 600, 400, and 800
pixels. It starts a new pass for every operation; preparation is shared within
the batch. Repeating just three widths on a permanent pass would eventually
measure cache hits instead of reflow.

## Reading results

Mitata warms and samples each operation, consumes returned values, and reports
latency distributions plus available heap/GC statistics. Fixture setup is outside
timing. Normal font cases warm font loading before measurement, but layout caches
remain fresh unless the case explicitly says `cache`. Fresh-provider cases do
not reset the operating system's file cache or measure process startup.

Use `--filter <regex>` to select full case names. `--list` avoids fixture setup.
`--smoke` executes each selected case twice and checks for errors; it produces no
performance measurements. Invalid flags and filters matching no cases fail.

Run timings on an idle machine, without concurrent tests, builds, or other
benchmark processes. Save `--json` output before and after a change, and compare
the same cases on the same machine, Bun version, and inputs. Mitata's JSON times
are nanoseconds; each benchmark's `runs[].stats` includes `avg`, `p50`, and `p99`.
The report includes runtime and CPU information. Record Git revisions alongside
saved reports. Repeat measurements before treating small differences as changes.
There are no timing assertions in the correctness suite.

To add a case, add a factory to `cases.ts`. The factory performs setup and returns
a synchronous function that returns its measured result. Keep inputs deterministic
and cache lifetimes explicit. The small CLI adapter in `runner.ts` is intentionally
copied into math and maps so their repositories remain independently runnable;
keep those copies in sync when changing command behavior.
