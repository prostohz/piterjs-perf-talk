import SvgCanvas from '../../packages/svgcanvas/svgcanvas.js'
import { getBBox } from '../../packages/svgcanvas/core/utilities.js'
import {
  getTransformList,
  transformListToTransform,
  transformPoint
} from '../../packages/svgcanvas/core/math.js'

describe('toolbar rotation normalization', () => {
  let svgCanvas

  beforeEach(() => {
    document.body.textContent = ''
    const editor = document.createElement('div')
    editor.id = 'svg_editor'
    const canvas = document.createElement('div')
    canvas.id = 'svgcanvas'
    canvas.style.visibility = 'hidden'
    const workarea = document.createElement('div')
    workarea.id = 'workarea'
    workarea.append(canvas)
    const toolsLeft = document.createElement('div')
    toolsLeft.id = 'tools_left'
    editor.append(workarea, toolsLeft)
    document.body.append(editor)

    svgCanvas = new SvgCanvas(canvas, {
      canvas_expansion: 3,
      dimensions: [640, 480],
      initFill: { color: 'FF0000', opacity: 1 },
      initStroke: { width: 5, color: '000000', opacity: 1 },
      initOpacity: 1,
      imgPath: '../editor/images',
      langPath: 'locale/',
      extPath: 'extensions/',
      extensions: [],
      initTool: 'select',
      wireframe: false
    })
  })

  const getVisualCenter = (elem) => {
    const box = getBBox(elem)
    return transformPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
      transformListToTransform(getTransformList(elem)).matrix
    )
  }

  it('keeps the visual center while replacing compound rotations', () => {
    svgCanvas.setSvgString(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
        <rect id="shape" x="0" y="0" width="100" height="50"
          transform="rotate(20 0 0) translate(30 10) rotate(10 50 25) scale(1.2 0.8)"/>
      </svg>
    `)
    const elem = document.getElementById('shape')
    svgCanvas.selectOnly([elem], true)
    const centerBefore = getVisualCenter(elem)

    svgCanvas.setRotationAngle(60)

    const tlist = getTransformList(elem)
    const centerAfter = getVisualCenter(elem)
    expect(tlist.numberOfItems).toBeLessThanOrEqual(2)
    expect(tlist.getItem(0).type).toBe(SVGTransform.SVG_TRANSFORM_ROTATE)
    expect(tlist.getItem(0).angle).toBeCloseTo(60, 5)
    expect(tlist.getItem(0).cx).toBeCloseTo(centerBefore.x, 5)
    expect(tlist.getItem(0).cy).toBeCloseTo(centerBefore.y, 5)
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 5)
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 5)
  })

  it('does not rewrite transforms when the requested angle is unchanged', () => {
    svgCanvas.setSvgString(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
        <rect id="shape" x="0" y="0" width="100" height="50"
          transform="rotate(30 50 25) matrix(1 0 0 1 10 20)"/>
      </svg>
    `)
    const elem = document.getElementById('shape')
    svgCanvas.selectOnly([elem], true)
    const transformBefore = elem.getAttribute('transform')

    svgCanvas.setRotationAngle(30)

    expect(elem.getAttribute('transform')).toBe(transformBefore)
  })

  it('undoes and redoes geometry baked while changing the angle', () => {
    svgCanvas.setSvgString(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
        <rect id="shape" x="0" y="0" width="100" height="50"
          transform="rotate(30 50 25) matrix(2 0 0 1 10 20)"/>
      </svg>
    `)
    const elem = document.getElementById('shape')
    const readState = () => ({
      transform: elem.getAttribute('transform'),
      x: elem.getAttribute('x'),
      y: elem.getAttribute('y'),
      width: elem.getAttribute('width'),
      height: elem.getAttribute('height')
    })
    const before = readState()
    const undoSize = svgCanvas.undoMgr.getUndoStackSize()
    svgCanvas.selectOnly([elem], true)

    svgCanvas.setRotationAngle(60)

    const after = readState()
    expect({ x: after.x, y: after.y, width: after.width, height: after.height })
      .not.toEqual({ x: before.x, y: before.y, width: before.width, height: before.height })
    const tlist = getTransformList(elem)
    expect(tlist.numberOfItems).toBe(1)
    expect(tlist.getItem(0).type).toBe(SVGTransform.SVG_TRANSFORM_ROTATE)
    expect(svgCanvas.undoMgr.getUndoStackSize()).toBe(undoSize + 1)

    svgCanvas.undoMgr.undo()
    expect(readState()).toEqual(before)

    svgCanvas.undoMgr.redo()
    expect(readState()).toEqual(after)
  })
})
