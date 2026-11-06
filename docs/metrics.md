# Metrics

Each run measures the metric selected in `targetMetric`. The pipeline recognizes the keys below and accounts for whether higher or lower values are better when calculating cost. The target harness implements the measurements. The SVGEdit target currently supports only `operationTimeMs`.

| Key                 | Metric                                     | Definition                                                                                                       | Better |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------ |
| `operationTimeMs`   | Operation time (ms)                        | End time minus start time for the specified operation                                                            | Lower  |
| `reactCommits`      | React commit count                         | Number of commits for the selected tree during the scenario, counting each commit once                           | Lower  |
| `reactRenderTimeMs` | Total React render time (ms)               | Sum of `actualDuration` for one selected React Profiler during the scenario, without adding nested profilers     | Lower  |
| `rafFps`            | Average `requestAnimationFrame` rate (FPS) | Number of intervals between consecutive callbacks during the scenario divided by their total duration in seconds | Higher |

For each scenario, the pipeline stores the raw samples, median, p95, minimum, maximum, and range (`max − min`). It calculates p95 with the nearest-rank method: take the sample at position `ceil(0.95 × N)` in the sorted series, counting from 1.

Measurement APIs: [React Profiler](https://react.dev/reference/react/Profiler), [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
