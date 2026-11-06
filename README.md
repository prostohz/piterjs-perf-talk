# Improving UI performance with a coding agent

This repository contains the materials for a PiterJS talk and an experimental pipeline for autonomously optimizing JavaScript libraries. Using SVGEdit, we explore how a coding agent finds improvements and validates them with tests and browser benchmarks.

[PiterJS talk slides (PDF, in Russian)](presentation/build/deck.pdf)

The optimizations from the experiment were submitted to SVGEdit in [PR #1111](https://github.com/SVG-Edit/svgedit/pull/1111). Sourcery's automated review [approved the PR without findings](https://github.com/SVG-Edit/svgedit/pull/1111#pullrequestreview-5618147277).

## How it works

1. The pipeline measures the original version of the library to establish a baseline.
2. The agent proposes a hypothesis and changes a separate copy of the source code.
3. The pipeline runs the tests and measures performance across a fixed set of scenarios.
4. If the tests pass, the results are valid, and the improvement meets the configured threshold, the pipeline accepts the changes. Otherwise, it keeps the previous version.

The cycle repeats until it reaches the time or iteration limit. Hypotheses, code changes, measurements, and decisions are saved in `runs/` and can be inspected in the Viewer.

## Viewer

The Viewer shows runs from `runs/`, including the cost chart, per-scenario measurements, hypotheses, decisions, and code diffs for each iteration.

```sh
npm i
npm run viewer
```

Open [localhost:4173](http://localhost:4173). To use a different port, run `npm run viewer -- 4174`.

## Repository layout

- [config.ts](config.ts) — agent settings, target metric, measurement count, budgets, and acceptance threshold.
- [docs/](docs/) — pipeline design, metrics, and requirements for adding a library.
- [src/](src/) — pipeline, agent integration, and Viewer.
- [tests/](tests/) — tests for the pipeline, CLI, agent integration, and Viewer. Run them with `npm test`.
- [targets/](targets/) — libraries to optimize, with source code, scenarios, and harnesses for testing and benchmarking.
- [runs/](runs/) — run results: hypotheses, code snapshots, measurements, and decisions for each iteration.
- [presentation/](presentation/) — talk slides in HTML and PDF.
