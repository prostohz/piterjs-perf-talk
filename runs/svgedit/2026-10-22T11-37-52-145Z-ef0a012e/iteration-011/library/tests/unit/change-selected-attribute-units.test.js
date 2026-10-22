import SvgCanvas from '../../packages/svgcanvas/svgcanvas.js'

// Regression test for https://github.com/SVG-Edit/svgedit/issues/949:
// setting a unit-suffixed attribute value (e.g. font-size="10pt") must
// preserve the unit instead of being silently truncated to a bare number.
describe('Issue 949: changeSelectedAttribute preserves unit suffixes', function () {
  let svgCanvas

  beforeEach(() => {
    document.body.textContent = ''
    const svgEditor = document.createElement('div')
    svgEditor.id = 'svg_editor'
    const svgcanvas = document.createElement('div')
    svgcanvas.style.visibility = 'hidden'
    svgcanvas.id = 'svgcanvas'
    const workarea = document.createElement('div')
    workarea.id = 'workarea'
    workarea.append(svgcanvas)
    const toolsLeft = document.createElement('div')
    toolsLeft.id = 'tools_left'

    svgEditor.append(workarea, toolsLeft)
    document.body.append(svgEditor)

    svgCanvas = new SvgCanvas(
      document.getElementById('svgcanvas'), {
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
      }
    )
  })

  it('keeps a "pt" unit suffix on font-size instead of truncating to a float', function () {
    svgCanvas.setSvgString(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">' +
        '<text id="t1" x="10" y="10" font-size="12">hi</text>' +
      '</svg>'
    )
    const elem = document.getElementById('t1')

    svgCanvas.changeSelectedAttribute('font-size', '10pt', [elem])

    assert.equal(elem.getAttribute('font-size'), '10pt')
  })

  it('keeps other unit suffixes (px, em, %) intact', function () {
    svgCanvas.setSvgString(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">' +
        '<rect id="r1" x="10" y="10" width="20" height="20" stroke-width="1"/>' +
      '</svg>'
    )
    const elem = document.getElementById('r1')

    svgCanvas.changeSelectedAttribute('stroke-width', '2px', [elem])
    assert.equal(elem.getAttribute('stroke-width'), '2px')

    svgCanvas.changeSelectedAttribute('stroke-width', '1.5em', [elem])
    assert.equal(elem.getAttribute('stroke-width'), '1.5em')
  })

  it('still converts a plain numeric string to a real number (issue #930)', function () {
    svgCanvas.setSvgString(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">' +
        '<g id="g1"><rect x="10" y="10" width="20" height="20"/></g>' +
      '</svg>'
    )
    const elem = document.getElementById('g1')

    svgCanvas.changeSelectedAttribute('rx', '10.5', [elem])

    assert.equal(elem.getAttribute('rx'), '10.5')
  })
})
