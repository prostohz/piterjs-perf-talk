import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0))

describe('se-spin-input', () => {
  beforeAll(async () => {
    globalThis.svgEditor = {
      configObj: {
        curConfig: {
          imgPath: ''
        }
      }
    }
    await import('../../src/editor/components/seSpinInput.js')
  })

  beforeEach(() => {
    document.body.textContent = ''
  })

  const createSpinInput = async (attrs = {}) => {
    const spin = document.createElement('se-spin-input')
    Object.entries(attrs).forEach(([name, value]) => {
      spin.setAttribute(name, value)
    })
    document.body.append(spin)
    await nextFrame()
    await nextFrame()
    return spin
  }

  const getTextInput = spin => {
    return spin.shadowRoot
      .querySelector('elix-number-spin-box')
      .shadowRoot
      .getElementById('input')
  }

  it('selects the current value on focus', async () => {
    const spin = await createSpinInput({ value: '123' })
    const input = getTextInput(spin)
    const select = vi.spyOn(input, 'select')

    input.dispatchEvent(new FocusEvent('focus'))

    expect(select).toHaveBeenCalledOnce()
  })

  it('commits typed values only on Enter', async () => {
    const spin = await createSpinInput({ value: '10', min: '0', max: '100' })
    const input = getTextInput(spin)
    const changes = []
    spin.addEventListener('change', () => changes.push(spin.value))

    input.dispatchEvent(new FocusEvent('focus'))
    input.value = '25'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))

    expect(changes).toEqual([])

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(changes).toEqual(['25'])
    expect(spin.value).toBe('25')
  })

  it('reverts invalid typed values on blur', async () => {
    const spin = await createSpinInput({ value: '10', min: '0', max: '100' })
    const input = getTextInput(spin)
    const changes = []
    spin.addEventListener('change', () => changes.push(spin.value))

    input.dispatchEvent(new FocusEvent('focus'))
    input.value = 'abc'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur'))

    expect(changes).toEqual([])
    expect(spin.value).toBe('10')
  })

  it('propagates spin button changes immediately', async () => {
    const spin = await createSpinInput({ value: '10', min: '0', max: '100', step: '5' })
    const elixInput = spin.shadowRoot.querySelector('elix-number-spin-box')
    const changes = []
    spin.addEventListener('change', () => changes.push(spin.value))

    elixInput.value = '15'
    elixInput.dispatchEvent(new CustomEvent('change', { bubbles: true }))

    expect(changes).toEqual(['15'])
    expect(spin.value).toBe('15')
  })

  it('propagates a spin button change after manual editing has started', async () => {
    const spin = await createSpinInput({ value: '10', min: '0', max: '100', step: '5' })
    const elixInput = spin.shadowRoot.querySelector('elix-number-spin-box')
    const input = getTextInput(spin)
    const upButton = elixInput.shadowRoot.getElementById('upButton')
    const changes = []
    spin.addEventListener('change', () => changes.push(spin.value))

    input.dispatchEvent(new FocusEvent('focus'))
    input.value = '12'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))

    // Let the wrapper observe the button press, but keep this unit test
    // independent from Elix's internal stepping implementation.
    elixInput.shadowRoot.addEventListener('mousedown', (e) => {
      e.stopImmediatePropagation()
    }, { capture: true, once: true })
    upButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    elixInput.value = '17'
    elixInput.dispatchEvent(new CustomEvent('change', { bubbles: true }))

    expect(changes).toEqual(['17'])
    expect(spin.value).toBe('17')
  })

  it('keeps manual edit handlers when Elix replaces its internal input', async () => {
    const spin = await createSpinInput({ value: '10', min: '0', max: '100' })
    const input = getTextInput(spin)
    const replacement = input.cloneNode()
    const changes = []
    spin.addEventListener('change', () => changes.push(spin.value))
    input.replaceWith(replacement)

    replacement.dispatchEvent(new FocusEvent('focus'))
    replacement.value = '25'
    replacement.dispatchEvent(new InputEvent('input', { bubbles: true }))
    replacement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(changes).toEqual(['25'])
    expect(spin.value).toBe('25')
  })
})
