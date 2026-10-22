/**
 * Tests for rotation recalculation when changing attributes on rotated elements.
 *
 * These tests verify two bugs that were fixed:
 *
 * Bug 1: Changing non-geometric attributes (stroke-width, fill, opacity, etc.)
 * on a rotated element would trigger an unnecessary rotation center recalculation,
 * corrupting compound transforms.
 *
 * Bug 2: The rotation center was computed through ALL remaining transforms
 * (including pre-rotation ones like translate), causing the translate to leak
 * into the center calculation and produce an incorrect rotation.
 *
 * Bug 3 (history.js only): The undo/redo code replaced the ENTIRE transform
 * attribute with just rotate(...), destroying any other transforms in the list.
 */

import { NS } from '../../packages/svgcanvas/core/namespaces.js'
import * as utilities from '../../packages/svgcanvas/core/utilities.js'
import * as history from '../../packages/svgcanvas/core/history.js'
import { getTransformList } from '../../packages/svgcanvas/core/math.js'

describe('Rotation recalculation on attribute change', function () {
  /**
   * Helper: create an SVG <rect> with the given attributes inside an <svg>.
   */
  function createSvgRect (attrs = {}) {
    const svg = document.createElementNS(NS.SVG, 'svg')
    document.body.appendChild(svg)
    const rect = document.createElementNS(NS.SVG, 'rect')
    for (const [k, v] of Object.entries(attrs)) {
      rect.setAttribute(k, v)
    }
    svg.appendChild(rect)
    return rect
  }

  /**
   * Helper: read back the transform list entries as simple objects for assertions.
   */
  function readTransforms (elem) {
    const tlist = getTransformList(elem)
    const result = []
    for (let i = 0; i < tlist.numberOfItems; i++) {
      const t = tlist.getItem(i)
      result.push({ type: t.type, matrix: { ...t.matrix } })
    }
    return result
  }

  afterEach(() => {
    document.body.textContent = ''
    // Reset mock to default (no rotation)
    utilities.mock({
      getHref () { return '#foo' },
      setHref () { /* empty fn */ },
      getRotationAngle () { return 0 }
    })
  })

  describe('ChangeElementCommand with rotated elements', function () {
    it('non-geometric attribute change preserves simple rotation', function () {
      const rect = createSvgRect({
        x: '0',
        y: '0',
        width: '100',
        height: '100',
        transform: 'rotate(30, 50, 50)',
        'stroke-width': '1'
      })

      // Mock getRotationAngle to return 30 (matching our transform)
      utilities.mock({
        getHref () { return '' },
        setHref () { /* empty fn */ },
        getRotationAngle () { return 30 }
      })

      const transformsBefore = readTransforms(rect)

      // Simulate changing stroke-width from 1 to 5
      rect.setAttribute('stroke-width', '5')
      const change = new history.ChangeElementCommand(rect, { 'stroke-width': '1' })

      // Apply (redo) — should NOT touch the transform
      change.apply()
      const transformsAfterApply = readTransforms(rect)
      assert.equal(transformsAfterApply.length, transformsBefore.length,
        'apply: transform list length unchanged')
      assert.equal(transformsAfterApply[0].type, 4,
        'apply: rotation transform preserved')

      // Unapply (undo) — should NOT touch the transform
      change.unapply()
      const transformsAfterUnapply = readTransforms(rect)
      assert.equal(transformsAfterUnapply.length, transformsBefore.length,
        'unapply: transform list length unchanged')
      assert.equal(transformsAfterUnapply[0].type, 4,
        'unapply: rotation transform preserved')
    })

    it('non-geometric attribute change preserves compound transforms', function () {
      const rect = createSvgRect({
        x: '0',
        y: '0',
        width: '100',
        height: '100',
        transform: 'translate(100, 50) rotate(30)',
        'stroke-width': '2'
      })

      utilities.mock({
        getHref () { return '' },
        setHref () { /* empty fn */ },
        getRotationAngle () { return 30 }
      })

      const tlistBefore = getTransformList(rect)
      assert.equal(tlistBefore.numberOfItems, 2,
        'setup: two transforms (translate + rotate)')
      assert.equal(tlistBefore.getItem(0).type, 2,
        'setup: first transform is translate')
      assert.equal(tlistBefore.getItem(1).type, 4,
        'setup: second transform is rotate')

      // Capture the translate matrix before
      const translateMatrix = { ...tlistBefore.getItem(0).matrix }

      // Simulate changing stroke-width from 2 to 5
      rect.setAttribute('stroke-width', '5')
      const change = new history.ChangeElementCommand(rect, { 'stroke-width': '2' })

      // Apply (redo) — must preserve both translate and rotate
      change.apply()
      const tlistAfter = getTransformList(rect)
      assert.equal(tlistAfter.numberOfItems, 2,
        'apply: still two transforms')
      assert.equal(tlistAfter.getItem(0).type, 2,
        'apply: first is still translate')
      assert.equal(tlistAfter.getItem(1).type, 4,
        'apply: second is still rotate')
      assert.closeTo(tlistAfter.getItem(0).matrix.e, translateMatrix.e, 0.01,
        'apply: translate tx preserved')
      assert.closeTo(tlistAfter.getItem(0).matrix.f, translateMatrix.f, 0.01,
        'apply: translate ty preserved')

      // Unapply (undo) — must also preserve both transforms
      change.unapply()
      assert.equal(tlistAfter.numberOfItems, 2,
        'unapply: still two transforms')
      assert.equal(tlistAfter.getItem(0).type, 2,
        'unapply: first is still translate')
      assert.equal(tlistAfter.getItem(1).type, 4,
        'unapply: second is still rotate')
    })

    it('geometric attribute change updates rotation center correctly', function () {
      // Element with simple rotation — changing x should update the rotation center
      const rect = createSvgRect({
        x: '0',
        y: '0',
        width: '100',
        height: '100',
        transform: 'rotate(45, 50, 50)'
      })

      utilities.mock({
        getHref () { return '' },
        setHref () { /* empty fn */ },
        getRotationAngle () { return 45 }
      })

      // Change x from 0 to 20 (new bbox center at 70, 50)
      rect.setAttribute('x', '20')
      const change = new history.ChangeElementCommand(rect, { x: '0' })

      // Apply should update the rotation center to (70, 50)
      change.apply()
      const tlist = getTransformList(rect)
      assert.equal(tlist.numberOfItems, 1, 'still one transform')
      assert.equal(tlist.getItem(0).type, 4, 'still a rotation')
      // The rotation center should reflect the new bbox center
      assert.closeTo(tlist.getItem(0).cx, 70, 0.01,
        'rotation cx updated to new bbox center')
      assert.closeTo(tlist.getItem(0).cy, 50, 0.01,
        'rotation cy unchanged')
    })

    it('geometric attribute change on compound transform uses only post-rotation transforms for center', function () {
      // Element with translate(100, 50) rotate(30)
      // When x changes, the rotation center should be computed from the
      // bbox center WITHOUT the pre-rotation translate leaking in.
      const rect = createSvgRect({
        x: '0',
        y: '0',
        width: '100',
        height: '100',
        transform: 'translate(100, 50) rotate(30)'
      })

      utilities.mock({
        getHref () { return '' },
        setHref () { /* empty fn */ },
        getRotationAngle () { return 30 }
      })

      const tlistBefore = getTransformList(rect)
      assert.equal(tlistBefore.numberOfItems, 2, 'setup: two transforms')

      // Change x from 0 to 20
      rect.setAttribute('x', '20')
      const change = new history.ChangeElementCommand(rect, { x: '0' })

      change.apply()
      const tlist = getTransformList(rect)

      // Should still have 2 transforms: translate + rotate
      assert.equal(tlist.numberOfItems, 2,
        'compound transform preserved (2 entries)')
      assert.equal(tlist.getItem(0).type, 2,
        'first is still translate')
      assert.equal(tlist.getItem(1).type, 4,
        'second is still rotate')

      // The translate should be unchanged
      assert.closeTo(tlist.getItem(0).matrix.e, 100, 0.01,
        'translate tx unchanged')
      assert.closeTo(tlist.getItem(0).matrix.f, 50, 0.01,
        'translate ty unchanged')

      // The rotation center should be (70, 50) — the new bbox center —
      // NOT (170, 100) which is what you'd get if the translate leaked in.
      assert.closeTo(tlist.getItem(1).cx, 70, 0.01,
        'rotation cx = new bbox center, not offset by translate')
      assert.closeTo(tlist.getItem(1).cy, 50, 0.01,
        'rotation cy = new bbox center, not offset by translate')
    })

    it('fill change does not trigger rotation recalculation', function () {
      const rect = createSvgRect({
        x: '0',
        y: '0',
        width: '100',
        height: '100',
        transform: 'rotate(45, 50, 50)',
        fill: 'red'
      })

      utilities.mock({
        getHref () { return '' },
        setHref () { /* empty fn */ },
        getRotationAngle () { return 45 }
      })

      const tlistBefore = getTransformList(rect)
      const cxBefore = tlistBefore.getItem(0).cx
      const cyBefore = tlistBefore.getItem(0).cy

      rect.setAttribute('fill', 'blue')
      const change = new history.ChangeElementCommand(rect, { fill: 'red' })

      change.apply()
      const tlistAfter = getTransformList(rect)
      assert.equal(tlistAfter.getItem(0).cx, cxBefore,
        'rotation cx unchanged after fill change')
      assert.equal(tlistAfter.getItem(0).cy, cyBefore,
        'rotation cy unchanged after fill change')
    })

    it('opacity change does not trigger rotation recalculation', function () {
      const rect = createSvgRect({
        x: '0',
        y: '0',
        width: '100',
        height: '100',
        transform: 'translate(50, 25) rotate(60)',
        opacity: '1'
      })

      utilities.mock({
        getHref () { return '' },
        setHref () { /* empty fn */ },
        getRotationAngle () { return 60 }
      })

      const tlistBefore = getTransformList(rect)
      assert.equal(tlistBefore.numberOfItems, 2, 'setup: two transforms')

      rect.setAttribute('opacity', '0.5')
      const change = new history.ChangeElementCommand(rect, { opacity: '1' })

      change.apply()
      const tlist = getTransformList(rect)
      assert.equal(tlist.numberOfItems, 2,
        'opacity change preserves compound transform count')
      assert.equal(tlist.getItem(0).type, 2, 'translate preserved')
      assert.equal(tlist.getItem(1).type, 4, 'rotate preserved')
    })
  })
})
