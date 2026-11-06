# Experimental optimization pipeline

## Agent

The pipeline uses Codex through `codex app-server`. The `CodingAgent` interface separates the agent integration from the pipeline. The agent factory supports only the `codex` provider.

The prompt prohibits the agent from modifying, deleting, disabling, or excluding existing library tests from a test run. Before verifying a candidate, the pipeline checks for changes to protected files. Dependencies, package manifests, and lockfiles are also protected.

## Measurements

- The pipeline runs each scenario `measurements.repeats` times under conditions defined by the target harness.
- `measurements.workers` sets the number of parallel measurement workers and defaults to 1. A worker runs all repetitions of one scenario in order, then takes the next scenario from the queue. SVGEdit gives each worker its own Chromium instance and server and creates a fresh browser context for each repetition.
- The baseline and all candidates use the same saved worker count. Preparation, tests, and iterations run sequentially; only scenarios within one evaluation run in parallel. Worker assignments are logged in `events.jsonl`, and results are written sequentially. On error, no new measurements start, active workers are closed, and results already saved remain in the report.
- The SVGEdit harness runs each repetition in a clean browser context with the HTTP cache disabled and no separate warm-up for the operation.
- For the metric selected in `targetMetric`, the pipeline stores the raw samples, median, p95, minimum, maximum, and range for each scenario.
- The baseline is the initial set of measurements for each scenario.

## Metrics

See [docs/metrics.md](metrics.md) for metric keys, definitions, and which direction counts as an improvement.

## Targets

See [docs/targets.md](targets.md) for the target layout and the `target.ts` contract.

## Pipeline

A new run starts at step 1. You can resume a stopped run with an additional budget.

The pipeline reads the target metric and acceptance threshold from the shared `config.ts`. The goal is to minimize overall cost across a fixed set of scenarios.

### Library snapshots

A library snapshot is a separate copy of its source code, tests, and build and dependency files used to verify a specific version. The pipeline creates and stores snapshots in `runs/<target>/<run-id>/`. It copies the baseline from `targets/<target>/library/` and each iteration from the last accepted snapshot, falling back to the baseline until it accepts a change.

The agent edits the current iteration's copy. The pipeline passes its path to `target.prepare`. Dependencies are installed and build artifacts are produced afresh. The `harness/` directory is outside the snapshot. Once an iteration ends, its snapshot is preserved as is.

### Budgets

- Total runtime and iteration limits are configurable.
- The time budget covers the entire run, including initial preparation, baseline evaluation, and every iteration stage.
- One iteration runs steps 2–4 for one hypothesis.
- The pipeline stops when it reaches either limit.
- If the time budget runs out, the pipeline interrupts the work in progress and does not accept an unfinished iteration.

### Resuming a run

- Resuming continues the same run in `runs/<target>/<run-id>/` with one baseline, one report, and a shared history. It does not merge separate runs.
- Only runs with a completed baseline can be resumed. The original baseline values used to normalize cost are retained without remeasurement.
- A new iteration starts from the last accepted snapshot, or from the baseline if there are no accepted changes. The agent receives the full history.
- Iteration numbering continues. For example, resuming a run after 10 iterations with a budget for 10 more yields iterations 11–20. An unfinished attempt keeps its number, data, and status. The pipeline starts a new iteration instead of restarting that attempt.
- To resume, specify the additional runtime and number of new iterations. The run stops at whichever limit it reaches first. Preparation counts against the time budget; idle time between sessions does not.
- Resuming uses the saved run settings. It checks target and harness fingerprints, agent version, the library's source commit, the scenario set, and the saved baseline and best snapshots. A run without a cost value cannot be resumed.
- The environment must match exactly: Node.js and component versions, OS, architecture, CPU models, memory, time zone, locale, `NODE_OPTIONS`, and the absolute project path. A mismatch blocks resumption.
- The report records work periods and additional budgets. The `.run-lock` directory prevents multiple processes from working on the same run concurrently.

You can view runs with anonymized paths or changed target fingerprints, but compatibility checks prevent `resume` from continuing them.

### Iteration history

The report records the runtime environment. All snapshots in a run are measured with the same harness and saved settings.

The history includes the baseline and all started iterations, including failed and interrupted attempts. For a completed evaluation, it stores the hypothesis, code snapshot, measurements, candidate and reference costs, percentage improvement, and decision with its rationale. On failure or interruption, it stores the available data, status, and reason for stopping. The hypothesis, cost, or complete set of measurements may be missing.

### Cost

Cost is the average of the normalized medians of the target metric across all scenarios:

- For a metric where lower is better: `cost = mean(candidateMedian / baselineMedian)`.
- For a metric where higher is better: `cost = mean(baselineMedian / candidateMedian)`.

All scenarios have equal weight. The scenario set and the original baseline stay fixed for the entire run, including when the run resumes. Baseline cost is 1; lower is better. A nonpositive baseline median stops the run with an error. The pipeline rejects candidates with undefined or infinite cost.

The code and reports use `cost` and `referenceCost`. The talk refers to cost as the objective function.

Improvement is `100 × (referenceCost − candidateCost) / referenceCost`. The reference is the last accepted version, or the baseline if none has been accepted. If the reference cost is zero, no further improvement is possible.

Individual scenarios may regress. The pipeline does not measure or store other metrics, and it does not use `constraintMetrics`.

### Algorithm

#### 1. Evaluate the baseline

The pipeline copies the files Git tracks in the original library, prepares the snapshot, runs its tests, and measures all selected scenarios. It saves the snapshot and results as the baseline.

#### 2. Propose a hypothesis and make changes

The pipeline copies the last accepted snapshot, or the baseline before the first improvement. The agent picks one hypothesis, edits that copy, and returns a JSON description of the change and its expected effect.

Before finishing, the agent calls `verify_library`, which prepares the snapshot and runs all library tests. Preparation and test failures are reported back to the agent so it can fix the same hypothesis in the same session. The pipeline starts measuring only after the final source code passes verification. Changing the code after verification invalidates the result.

#### 3. Evaluate the hypothesis

The pipeline prepares the verified snapshot again for benchmarking. An agent failure, measurement error, or invalid scenario result ends the entire run without a retry. The pipeline saves the reason and available results and does not accept the current iteration. An error during baseline evaluation also stops the run.

The pipeline measures the candidate across all scenarios, with `measurements.repeats` repetitions, and calculates cost. It accepts the candidate if all checks pass and the improvement over the last accepted version meets `minImprovementPercent`. Otherwise, it rejects the candidate. The threshold applies to overall cost.

#### 4. Update the reference

An accepted snapshot and its measurements become the new reference. If the candidate is rejected, the previous reference remains in place. The original baseline used for normalization stays fixed. The next iteration starts at step 2.

## Configuration

The root `config.ts` file contains the agent, metric, measurement, and budget settings shared by all targets. The current settings are:

```ts
export default {
  agent: {
    provider: "codex",
    model: "gpt-6.1-sol",
    reasoningEffort: "medium",
  },
  targetMetric: "operationTimeMs",
  measurements: {
    repeats: 100,
    workers: 5,
  },
  budgets: {
    maxDurationMinutes: 240,
    maxIterations: 10,
  },
  minImprovementPercent: 1,
};
```

Metric keys are listed in [docs/metrics.md](metrics.md).

## Running the pipeline

Install project dependencies with `npm i`, install and sign in to the Codex CLI, and clone the library as a separate Git repository under `targets/<target>/library/`. Check out the commit specified in `source.json`. The harness installs dependencies and Chromium when it prepares a snapshot. SVGEdit requires Node.js 26 or later.

Run `npm run pipeline -- <target>` from the repository root. The command loads the target from `targets/<target>/`, reads the shared `config.ts`, and starts the autonomous optimization loop.

To resume a run with its saved settings for up to 60 more minutes and 10 new iterations, run `npm run pipeline -- resume <target>/<run-id> --minutes 60 --iterations 10`.

## Repository layout

```text
config.ts
src/
tests/
targets/
runs/
  <target>/
    <run-id>/
docs/
```

## Run output

Each new run creates `runs/<target>/<run-id>/`. Resuming a run adds to the same directory:

- `report.json` — environment, configuration, work periods and budgets, baseline, all iterations, samples, statistics, costs, and decisions. `best` points to the last accepted snapshot.
- `events.jsonl`, `worker.log` — pipeline stages and target process output.
- `baseline/library/`, `iteration-NNN/library/` — source code for the evaluated versions.
- `iteration-NNN/agent/` — prompt, command, events, and final response for one agent session, including builds, tests, and fixes.

Git ignores logs, agent sessions, and temporary files.

## Viewer

The Viewer uses React, Tailwind CSS, and shadcn/ui. Run `npm run viewer` to start the Vite dev server at `http://127.0.0.1:4173`. To use a different port, run `npm run viewer -- 4174`.

The Viewer reads `runs/<target>/<run-id>/report.json`. It displays scenario timings in microseconds; reports store `operationTimeMs` and `reactRenderTimeMs` in milliseconds.

For a completed iteration, expand **Code changes** to load the diff between its library snapshot and its `parent`. **Cumulative code changes** compares the last accepted snapshot (`best`) with the baseline and shows the number of lines added and removed. It excludes rejected attempts.
