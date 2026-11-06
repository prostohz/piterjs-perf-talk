# Target structure

A target combines the original library with a harness for testing and benchmarking its [snapshots](pipeline.md#library-snapshots). You can prepare a target without running the autonomous optimization loop. All paths below are relative to the repository root.

## Layout

Each library has a directory at `targets/<name>`:

```text
targets/
  <name>/
    target.ts
    source.json
    library/
    harness/
```

- `source.json` — the library repository URL and full source commit SHA.
- `target.ts` — the pipeline entry point. Its default export implements the `Target` interface.
- `library/` — a separate Git repository for the library under test, ignored by the main repository.
- `harness/` — the test application, scenarios, fixtures, and measurement code.
- The agent edits a library snapshot, and the harness loads the snapshot it receives.
- Keeping the library separate lets you commit accepted changes and submit them upstream without including the harness.

### Example source.json

For SVGEdit:

```json
{
  "repository": "https://github.com/SVG-Edit/svgedit.git",
  "commit": "c44f061d2f9a626d2771cc931298af5a45522d87"
}
```

Git tracks `source.json` in the main repository. The pipeline uses a pre-cloned `library/`, verifies that it is a separate Git repository with HEAD at the specified commit, and copies its tracked files. Uncommitted changes block baseline creation.

## Scenarios

The harness defines scenarios that reflect typical library usage and use fixed fixtures. Each scenario specifies the timing boundaries, the workload, the operation to measure, and how to validate the result.

## Target interface

The pipeline loads `targets/<target>/target.ts` and passes it the path to the library snapshot under test.

```ts
import type { Metric } from "../../src/pipeline/metrics.js";

interface Target {
  scenarios: string[];
  prepare(libraryPath: string): Promise<TargetSession>;
}

interface MeasurementWorker {
  measure(
    scenario: string,
    targetMetric: Metric,
  ): Promise<Record<string, number>>;
  close(): Promise<void>;
}

interface TargetSession extends MeasurementWorker {
  test(): Promise<void>;
  createWorker?(): Promise<MeasurementWorker>;
}
```

- `scenarios` — identifiers for the fixed scenarios defined by the harness.
- `prepare` installs the library and harness dependencies with `npm ci`, builds the supplied snapshot, and returns a session. SVGEdit checks the library lockfile against the saved copy at `harness/library-package-lock.json`.
- `test` runs the library's tests and reports an error if they fail.
- `measure` runs one repetition of a scenario in a fresh browser context with the HTTP cache disabled and no separate warm-up for the operation. It returns an object with one key, the selected metric. An unsupported metric or an invalid scenario result causes an error. The SVGEdit target currently supports only `operationTimeMs`.
- `close` shuts down the browser and harness server. Once the pipeline has obtained a session, it calls this method in `finally`.
- `createWorker` starts an independent measurement worker for an already prepared snapshot without reinstalling dependencies, rebuilding, or rerunning tests. The main session acts as the first worker. The pipeline creates the other workers after tests and before measurement. The method is required when `measurements.workers > 1`; without it, only sequential measurement is available. SVGEdit gives each worker its own Chromium instance and server. `close` must be safe to call more than once: on error, the pipeline closes active workers before leaving the evaluation.

The pipeline manages snapshots, the agent, repeat counts, statistics, and comparisons. It prepares the snapshot when `verify_library` is called and again before benchmarking. After the session ends, the pipeline restores the snapshot's source tree by removing installed dependencies and build artifacts.

The integrity check detects modified or deleted target source files and any changes to the original library. It does not check for newly added harness files.

## Verification

There is no separate readiness check. The pipeline checks the build, tests, and result correctness during a run:

- The baseline goes through preparation, tests, and measurement for all scenarios.
- Each candidate passes `verify_library` before benchmarking.
- The pipeline checks that results contain only the selected metric, that values are finite and nonnegative, that sample series are complete, and that baseline medians are positive.
- The harness validates the result of each operation. If a result is invalid, the pipeline records the error and stops the run.

The pipeline does not create separate reports or snapshots for readiness checks.
