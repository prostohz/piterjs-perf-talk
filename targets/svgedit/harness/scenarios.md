# SVGEdit scenarios

The fixtures alternate 12×12 rectangles and circles with two fill colors on a 40-column grid with 20-unit spacing. The generator in `fixtures.ts` uses deterministic IDs, coordinates, and dimensions.

All commands run in the actual editor. Timing covers only the synchronous API call and its handlers. Setup and validation happen outside the measured interval.

The harness records elapsed time in milliseconds using `performance.now()`. The server enables cross-origin isolation with COOP `same-origin` and COEP `require-corp` so Chromium uses 5 µs timer resolution. The harness checks `crossOriginIsolated` before measuring.

| Scenario         | Initial state                          | Measured command                     | Result checks                                                                     |
| ---------------- | -------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `select-500`     | 500 shapes, none selected              | Select the layer                     | All 500 expected IDs; unchanged geometry and history                              |
| `move-500`       | 500 selected shapes                    | Move by (20, 10)                     | Each shape's coordinates, dimensions, and fill; history entry                     |
| `duplicate-500`  | 500 selected shapes                    | Duplicate with an offset of (20, 10) | 1,000 shapes; unique IDs; copies' geometry and fill; history                      |
| `group-500`      | 500 selected shapes                    | Group the selection                  | One selected group containing all shapes; geometry and history                    |
| `ungroup-500`    | One selected group of 500 shapes       | Ungroup the selection                | 500 selected shapes directly in the layer; geometry and history                   |
| `align-left-500` | 500 selected shapes                    | Align left relative to the selection | All x coordinates equal 20; unchanged y coordinates and dimensions; history entry |
| `fill-500`       | 500 selected shapes                    | Set the fill to `#4060a0`            | Each shape's fill; unchanged geometry; history entry                              |
| `delete-500`     | 500 selected shapes                    | Delete the selection                 | No shapes or selection; history entry                                             |
| `undo-move-500`  | 500 shapes moved by (20, 10)           | Undo                                 | Original coordinates and properties; history stack sizes                          |
| `redo-move-500`  | The move of 500 shapes has been undone | Redo                                 | Updated coordinates, properties, and history stacks                               |

Every scenario checks the shape count, ID uniqueness, geometry, and fill. Commands that change the document also check for a history change. These checks are independent of timing, so a no-op cannot count as a speedup.

The harness does not undo a command after validating its result. Each repetition starts in a fresh browser context, and the library tests verify that operations can be undone. In `undo-move-500` and `redo-move-500`, undo and redo are themselves the measured commands, with their own setup and result checks.

Every scenario starts with a document containing 500 shapes. The pipeline gives all ten scenarios equal weight when averaging their normalized medians.
