import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NS } from '../../packages/svgcanvas/core/namespaces.js'
import { init as initEvent } from '../../packages/svgcanvas/core/event.js'
import { init as initUtilities } from '../../packages/svgcanvas/core/utilities.js'
import { getTransformList } from '../../packages/svgcanvas/core/math.js'

const createSvgElement = (name) => {
  return document.createElementNS(NS.SVG, name)
}

describe('event', () => {
  /** @type {HTMLDivElement} */
  let root
  /** @type {any} */
  let canvas
  /** @type {HTMLDivElement} */
  let svgcanvas
  /** @type {SVGSVGElement} */
  let svgcontent
  /** @type {SVGGElement} */
  let contentGroup
  /** @type {SVGRectElement} */
  let rubberBox

  beforeEach(() => {
    root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)

    svgcanvas = document.createElement('div')
    svgcanvas.id = 'svgcanvas'
    root.append(svgcanvas)

    svgcontent = /** @type {SVGSVGElement} */ (createSvgElement('svg'))
    svgcontent.id = 'svgcontent'
    root.append(svgcontent)

    contentGroup = /** @type {SVGGElement} */ (createSvgElement('g'))
    svgcontent.append(contentGroup)

    contentGroup.getScreenCTM = () => ({
      inverse: () => ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0
      })
    })

    Object.defineProperty(contentGroup, 'transform', {
      value: { baseVal: { numberOfItems: 0 } },
      configurable: true
    })

    rubberBox = /** @type {SVGRectElement} */ (createSvgElement('rect'))

    canvas = {
      spaceKey: false,
      started: false,
      startTransform: null,
      rootSctm: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      rubberBox: null,
      selectorManager: {
        selectorParentGroup: createSvgElement('g'),
        getRubberBandBox () {
          return rubberBox
        }
      },
      $id (id) {
        return document.getElementById(id)
      },
      getDataStorage () {
        return { get () {} }
      },
      getSelectedElements () {
        return []
      },
      getZoom () {
        return 1
      },
      getStyle () {
        return { opacity: 1 }
      },
      getSvgRoot () {
        return svgcontent
      },
      getId () {
        return 'svg_1'
      },
      getCurConfig () {
        return { gridSnapping: false, showRulers: false }
      },
      setRootSctm (m) {
        this.rootSctm = m
      },
      getrootSctm () {
        return this.rootSctm
      },
      getStarted () {
        return this.started
      },
      setStarted (started) {
        this.started = started
      },
      setStartX (x) {
        this.startX = x
      },
      setStartY (y) {
        this.startY = y
      },
      getStartX () {
        return this.startX
      },
      getStartY () {
        return this.startY
      },
      setRStartX (x) {
        this.rStartX = x
      },
      setRStartY (y) {
        this.rStartY = y
      },
      getMouseTarget () {
        return contentGroup
      },
      getCurrentMode () {
        return this.currentMode || 'zoom'
      },
      setCurrentMode (mode) {
        this.currentMode = mode
      },
      setMode () {},
      setLastClickPoint () {},
      getStartTransform () {
        return this.startTransform
      },
      setStartTransform (transform) {
        this.startTransform = transform
      },
      clearSelection () {},
      setCurrentResizeMode () {},
      setJustSelected () {},
      pathActions: {
        clear () {}
      },
      textActions: {
        init () {}
      },
      setRubberBox (box) {
        this.rubberBox = box
      },
      getRubberBox () {
        return this.rubberBox
      },
      runExtensions () {
        return []
      }
    }

    initEvent(canvas)
    initUtilities(canvas)
  })

  afterEach(() => {
    root.remove()
  })

  it('mouseDownEvent() zoom mode uses clientY for rubberbox y', () => {
    canvas.setCurrentMode('zoom')
    canvas.mouseDownEvent({
      clientX: 10,
      clientY: 20,
      button: 0,
      altKey: false,
      shiftKey: false,
      preventDefault () {},
      target: contentGroup
    })

    expect(rubberBox.getAttribute('x')).toBe('10')
    expect(rubberBox.getAttribute('y')).toBe('20')
  })

  it('mouseOutEvent() dispatches mouseup with coordinates', () => {
    canvas.setCurrentMode('rect')
    canvas.setStarted(true)

    /** @type {{ x: number, y: number }|null} */
    let received = null
    svgcanvas.addEventListener('mouseup', (evt) => {
      received = { x: evt.clientX, y: evt.clientY }
    })

    canvas.mouseOutEvent(new MouseEvent('mouseleave', { clientX: 15, clientY: 25 }))

    expect(received).toEqual({ x: 15, y: 25 })
  })

  it('mouseUpEvent() emits changed after drag cleanup updates selected element', () => {
    const rect = /** @type {SVGRectElement} */ (createSvgElement('rect'))
    rect.setAttribute('x', '10')
    rect.setAttribute('y', '20')
    rect.setAttribute('width', '30')
    rect.setAttribute('height', '40')
    contentGroup.append(rect)

    const transform = svgcontent.createSVGTransform()
    transform.setTranslate(5, 6)
    rect.transform.baseVal.appendItem(transform)

    const changedCalls = []
    canvas.started = true
    canvas.currentMode = 'select'
    canvas.rStartX = 10
    canvas.rStartY = 20
    canvas.selectedElements = [rect]
    canvas.startTransform = 'saved-transform'
    canvas.dragStartTransforms = new Map([[rect, '']])
    canvas.getSelectedElements = () => canvas.selectedElements
    canvas.getRStartX = () => canvas.rStartX
    canvas.getRStartY = () => canvas.rStartY
    canvas.getJustSelected = () => null
    canvas.setJustSelected = () => {}
    canvas.setCurProperties = () => {}
    canvas.setCurText = () => {}
    canvas.selectorManager.requestSelector = () => ({
      showGrips () {},
      resize () {}
    })
    let startTransformDuringRecalculation
    canvas.recalculateDimensions = () => {
      startTransformDuringRecalculation = canvas.getStartTransform()
      return { apply () {}, unapply () {} }
    }
    canvas.addCommandToHistory = () => {}
    canvas.call = (name, payload) => {
      if (name === 'changed') changedCalls.push(payload)
    }

    canvas.mouseUpEvent({
      button: 0,
      clientX: 15,
      clientY: 26,
      target: rect,
      preventDefault () {}
    })

    expect(changedCalls).toEqual([[rect]])
    expect(startTransformDuringRecalculation).toBe('')
    expect(canvas.getStartTransform()).toBe('saved-transform')
  })

  it('mouseMoveEvent() does not add identity transform before drag threshold', () => {
    const group = /** @type {SVGGElement} */ (createSvgElement('g'))
    contentGroup.append(group)

    canvas.started = true
    canvas.currentMode = 'select'
    canvas.startX = 10
    canvas.startY = 20
    canvas.selectedElements = [group]
    canvas.getSelectedElements = () => canvas.selectedElements
    canvas.selectorManager.requestSelector = () => ({
      resize () {}
    })
    canvas.call = () => {}

    canvas.mouseMoveEvent({
      button: 0,
      clientX: 14,
      clientY: 24,
      preventDefault () {}
    })

    expect(getTransformList(group).numberOfItems).toBe(0)
    expect(group.getAttribute('transform')).toBeNull()
  })

  it('mouseMoveEvent() preserves existing leading translate when drag starts', () => {
    const group = /** @type {SVGGElement} */ (createSvgElement('g'))
    group.setAttribute('transform', 'translate(-165 -215)')
    contentGroup.append(group)

    canvas.started = true
    canvas.currentMode = 'select'
    canvas.startX = 10
    canvas.startY = 20
    canvas.selectedElements = [group]
    canvas.getSelectedElements = () => canvas.selectedElements
    canvas.selectorManager.requestSelector = () => ({
      resize () {}
    })
    canvas.call = () => {}

    canvas.mouseMoveEvent({
      button: 0,
      clientX: 15,
      clientY: 25,
      preventDefault () {}
    })

    const tlist = getTransformList(group)
    expect(tlist.numberOfItems).toBe(2)
    expect(tlist.getItem(0).type).toBe(SVGTransform.SVG_TRANSFORM_TRANSLATE)
    expect(tlist.getItem(0).matrix.e).toBe(5)
    expect(tlist.getItem(0).matrix.f).toBe(5)
    expect(tlist.getItem(1).type).toBe(SVGTransform.SVG_TRANSFORM_TRANSLATE)
    expect(tlist.getItem(1).matrix.e).toBe(-165)
    expect(tlist.getItem(1).matrix.f).toBe(-215)
  })

  it('mouseUpEvent() emits final selected event after multiselect', () => {
    const rect = /** @type {SVGRectElement} */ (createSvgElement('rect'))
    const ellipse = /** @type {SVGEllipseElement} */ (createSvgElement('ellipse'))
    contentGroup.append(rect, ellipse)

    const selectedCalls = []
    canvas.started = true
    canvas.currentMode = 'multiselect'
    canvas.rStartX = 10
    canvas.rStartY = 20
    canvas.selectedElements = [rect, ellipse]
    canvas.getSelectedElements = () => canvas.selectedElements
    canvas.getRStartX = () => canvas.rStartX
    canvas.getRStartY = () => canvas.rStartY
    canvas.setCurBBoxes = () => {}
    canvas.getJustSelected = () => null
    canvas.setJustSelected = () => {}
    canvas.setCurProperties = () => {}
    canvas.setCurText = () => {}
    canvas.selectorManager.requestSelector = () => ({
      showGrips () {},
      resize () {}
    })
    canvas.call = (name, payload) => {
      if (name === 'selected') selectedCalls.push(payload)
    }

    canvas.mouseUpEvent({
      button: 0,
      clientX: 10,
      clientY: 20,
      target: svgcontent,
      preventDefault () {}
    })

    expect(canvas.currentMode).toBe('select')
    expect(selectedCalls).toEqual([[rect, ellipse]])
  })

  it('mouseDownEvent() returns early if root group is missing', () => {
    while (svgcontent.firstChild) {
      svgcontent.firstChild.remove()
    }
    expect(() => {
      canvas.mouseDownEvent({ button: 0 })
    }).not.toThrow()
  })
})
