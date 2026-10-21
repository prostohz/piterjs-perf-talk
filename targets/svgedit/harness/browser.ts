import type { Page } from "playwright";
import { fixture } from "./fixtures.js";

interface Canvas {
  selectAllInCurrentLayer(): void;
  getSelectedElements(): (SVGGraphicsElement | null)[];
  getZoom(): number;
  moveSelectedElements(x: number, y: number): void;
  cloneSelectedElements(x: number, y: number): void;
  groupSelectedElements(): void;
  ungroupSelectedElement(): void;
  alignSelectedElements(type: string, relativeTo: string): void;
  changeSelectedAttribute(name: string, value: string): void;
  deleteSelectedElements(): void;
  undoMgr: {
    undo(): void;
    redo(): void;
    getUndoStackSize(): number;
    getRedoStackSize(): number;
  };
}

declare global {
  interface Window {
    svgEditor: {
      svgCanvas: Canvas;
      isReady: boolean;
      loadSvgString(svg: string): void;
    };
    __coverage__?: unknown;
  }
}

export async function measure(
  page: Page,
  origin: string,
  scenario: string,
): Promise<number> {
  const { count, svg } = fixture(scenario);
  await page.addInitScript(
    "globalThis.__name = (fn, name) => Object.defineProperty(fn, 'name', { value: name, configurable: true });",
  );
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(
    () =>
      window.svgEditor?.isReady &&
      window.svgEditor.svgCanvas &&
      document.querySelector("#svgroot"),
  );
  const dialog = page.locator("se-storage-dialog");
  await dialog.waitFor({ state: "attached" });
  if ((await dialog.getAttribute("dialog")) === "open")
    await dialog.locator("button#storage_ok").click({ force: true });
  return page.evaluate(
    async ({ scenario, count, svg }) => {
      if (!globalThis.crossOriginIsolated)
        throw new Error("Cross-origin isolation is required for measurements");
      const canvas = window.svgEditor.svgCanvas;
      if (window.__coverage__)
        throw new Error("Coverage build cannot be measured");
      window.svgEditor.loadSvgString(svg);
      if (canvas.getZoom() !== 1) throw new Error("Unexpected zoom");
      const elements = () =>
        Array.from(
          document.querySelectorAll<SVGGraphicsElement>(
            "#svgcontent rect, #svgcontent circle",
          ),
        );
      const selected = () =>
        canvas
          .getSelectedElements()
          .filter((el): el is SVGGraphicsElement => el !== null);
      const check = (condition: boolean, label: string) => {
        if (!condition) throw new Error(`${scenario}: ${label}`);
      };
      const expected = (i: number) => ({
        id: `fixture_${i}`,
        tag: i % 2 ? "circle" : "rect",
        x: 20 + (i % 40) * 20,
        y: 20 + Math.floor(i / 40) * 20,
        width: 12,
        height: 12,
        fill: i % 2 ? "#5080b0" : "#b08050",
      });
      type Shape = ReturnType<typeof expected>;
      const geometry = (el: SVGGraphicsElement): Shape => {
        const root = document.querySelector<SVGSVGElement>("#svgcontent")!;
        const matrix = root.getCTM()!.inverse().multiply(el.getCTM()!);
        const box = el.getBBox();
        const start = new DOMPoint(box.x, box.y).matrixTransform(matrix);
        const end = new DOMPoint(
          box.x + box.width,
          box.y + box.height,
        ).matrixTransform(matrix);
        return {
          id: el.id,
          tag: el.tagName,
          x: start.x,
          y: start.y,
          width: end.x - start.x,
          height: end.y - start.y,
          fill: el.getAttribute("fill")!,
        };
      };
      const assertShape = (actual: Shape, desired: Shape) => {
        check(
          actual.tag === desired.tag && actual.fill === desired.fill,
          `Shape style ${desired.id}`,
        );
        for (const key of ["x", "y", "width", "height"] as const)
          check(
            Math.abs(actual[key] - desired[key]) < 0.01,
            `Geometry ${desired.id}.${key}: ${actual[key]} != ${desired[key]}`,
          );
      };
      const assertOriginals = (
        dx = 0,
        dy = 0,
        fill?: string,
        aligned = false,
      ) => {
        for (let i = 0; i < count; i++) {
          const desired = expected(i);
          const el = document.getElementById(
            desired.id,
          ) as SVGGraphicsElement | null;
          check(Boolean(el), `Missing ${desired.id}`);
          desired.x = aligned ? 20 : desired.x + dx;
          desired.y += dy;
          if (fill) desired.fill = fill;
          assertShape(geometry(el!), desired);
        }
      };
      check(elements().length === count, "Initial shape count");
      assertOriginals();
      if (scenario !== "select-500") canvas.selectAllInCurrentLayer();
      if (scenario === "ungroup-500") canvas.groupSelectedElements();
      if (scenario === "undo-move-500" || scenario === "redo-move-500") {
        canvas.moveSelectedElements(20, 10);
        assertOriginals(20, 10);
        if (scenario === "redo-move-500") {
          canvas.undoMgr.undo();
          assertOriginals();
        }
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const undoBefore = canvas.undoMgr.getUndoStackSize();
      const redoBefore = canvas.undoMgr.getRedoStackSize();
      const start = performance.now();
      switch (scenario) {
        case "select-500":
          canvas.selectAllInCurrentLayer();
          break;
        case "move-500":
          canvas.moveSelectedElements(20, 10);
          break;
        case "duplicate-500":
          canvas.cloneSelectedElements(20, 10);
          break;
        case "group-500":
          canvas.groupSelectedElements();
          break;
        case "ungroup-500":
          canvas.ungroupSelectedElement();
          break;
        case "align-left-500":
          canvas.alignSelectedElements("l", "selected");
          break;
        case "fill-500":
          canvas.changeSelectedAttribute("fill", "#4060a0");
          break;
        case "delete-500":
          canvas.deleteSelectedElements();
          break;
        case "undo-move-500":
          canvas.undoMgr.undo();
          break;
        case "redo-move-500":
          canvas.undoMgr.redo();
          break;
        default:
          throw new Error(`Invalid scenario: ${scenario}`);
      }
      const duration = performance.now() - start;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const shapes = elements();
      const shapeCount =
        scenario === "delete-500"
          ? 0
          : scenario === "duplicate-500"
            ? count * 2
            : count;
      check(shapes.length === shapeCount, "Result shape count");
      const allIds = Array.from(
        document.querySelectorAll("#svgcontent [id]"),
        (el) => el.id,
      );
      check(new Set(allIds).size === allIds.length, "Duplicate IDs");
      if (scenario !== "delete-500")
        assertOriginals(
          ["move-500", "redo-move-500"].includes(scenario) ? 20 : 0,
          ["move-500", "redo-move-500"].includes(scenario) ? 10 : 0,
          scenario === "fill-500" ? "#4060a0" : undefined,
          scenario === "align-left-500",
        );
      if (scenario === "select-500") {
        check(selected().length === count, "Selected count");
        check(new Set(selected()).size === count, "Unique selection");
        check(
          selected().every((el) => /^fixture_\d+$/.test(el.id)),
          "Selected IDs",
        );
        check(
          canvas.undoMgr.getUndoStackSize() === undoBefore,
          "Selection changed history",
        );
      } else if (scenario === "duplicate-500") {
        const clones = shapes.filter((el) => !el.id.startsWith("fixture_"));
        check(
          clones.every((el) => selected().includes(el)),
          "Selected clones",
        );
        check(
          clones.length === count && selected().length === count,
          "Clone count or selection",
        );
        const signature = (shape: Shape) =>
          JSON.stringify([
            shape.tag,
            Math.round(shape.x * 100),
            Math.round(shape.y * 100),
            shape.width,
            shape.height,
            shape.fill,
          ]);
        const actual = clones.map((el) => signature(geometry(el))).sort();
        const desired = Array.from({ length: count }, (_, i) => {
          const shape = expected(i);
          shape.x += 20;
          shape.y += 10;
          return signature(shape);
        }).sort();
        check(
          JSON.stringify(actual) === JSON.stringify(desired),
          "Clone geometry",
        );
      } else if (scenario === "group-500") {
        const group = selected()[0];
        check(
          selected().length === 1 && group?.tagName === "g",
          "Group selection",
        );
        check(
          shapes.every((el) => el.parentNode === group),
          "Group membership",
        );
      } else if (scenario === "ungroup-500") {
        check(selected().length === count, "Ungroup selection");
        check(new Set(selected()).size === count, "Unique ungroup selection");
        check(
          shapes.every((el) => el.parentElement?.classList.contains("layer")),
          "Ungroup membership",
        );
      } else if (scenario === "delete-500") {
        check(selected().length === 0, "Deleted selection");
      }
      if (scenario === "undo-move-500") {
        check(
          canvas.undoMgr.getUndoStackSize() === undoBefore - 1 &&
            canvas.undoMgr.getRedoStackSize() === redoBefore + 1,
          "Undo history",
        );
      } else if (scenario === "redo-move-500") {
        check(
          canvas.undoMgr.getUndoStackSize() === undoBefore + 1 &&
            canvas.undoMgr.getRedoStackSize() === redoBefore - 1,
          "Redo history",
        );
      } else if (scenario !== "select-500") {
        check(
          canvas.undoMgr.getUndoStackSize() === undoBefore + 1,
          "Operation history",
        );
      }
      return duration;
    },
    { scenario, count, svg },
  );
}
