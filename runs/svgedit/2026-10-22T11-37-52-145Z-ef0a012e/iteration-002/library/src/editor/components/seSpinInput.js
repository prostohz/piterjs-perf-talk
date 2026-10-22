/* globals svgEditor */
import '../dialogs/se-elix/define/NumberSpinBox.js'
import { t } from '../locale.js'

const template = document.createElement('template')
template.innerHTML = `
  <style>
  div {
    height: 24px;
    margin: 5px 1px;
    padding: 3px;
  }
  div.imginside {
    width: var(--global-se-spin-input-width);
  }
  img {
    position: relative;
    right: -4px;
    top: 2px;
  }
  span {
    bottom: -0.5em;
    right: -4px;
    position: relative;
    margin-left: -4px;
    margin-right: 1px;
    color: #fff;
  }
  elix-number-spin-box {
    background-color: var(--input-color);
    border-radius: 3px;
    height: 20px;
    margin-top: 1px;
    vertical-align: top;
  }
  elix-number-spin-box::part(spin-button) {
    padding: 0px;
  }
  elix-number-spin-box::part(input) {
    width: 3em;
  }
  elix-number-spin-box{
    width: 54px;
    height: 24px;
  }
  </style>
  <div>
  <img alt="icon" width="24" height="24" aria-labelledby="label" />
  <span id="label">label</span>
  <elix-number-spin-box min="1" step="1"></elix-number-spin-box>
  </div>
`

/**
 * @class SESpinInput
 */
export class SESpinInput extends HTMLElement {
  /**
    * @function constructor
    */
  constructor () {
    super()
    // create the shadowDom and insert the template
    this._shadowRoot = this.attachShadow({ mode: 'open' })
    this._shadowRoot.append(template.content.cloneNode(true))
    // locate the component
    this.$div = this._shadowRoot.querySelector('div')
    this.$img = this._shadowRoot.querySelector('img')
    this.$label = this._shadowRoot.getElementById('label')
    this.$input = this._shadowRoot.querySelector('elix-number-spin-box')
    this.imgPath = svgEditor.configObj.curConfig.imgPath
    this.committedValue = this.$input.value
    this.manualEdit = false
    this.inputEventsConnected = false
  }

  #isValidValue (value) {
    const normalized = String(value).trim()
    if (normalized === '') return false

    const number = Number(normalized)
    if (!Number.isFinite(number)) return false

    const min = this.getAttribute('min')
    const max = this.getAttribute('max')
    return (min === null || number >= Number(min)) &&
      (max === null || number <= Number(max))
  }

  #dispatchChange () {
    this.dispatchEvent(new CustomEvent('change'))
  }

  #commitValue (value) {
    if (!this.#isValidValue(value)) {
      this.#revertValue()
      return
    }

    this.value = value
    this.committedValue = String(this.value)
    this.manualEdit = false
    this.#dispatchChange()
  }

  #revertValue () {
    this.manualEdit = false
    this.value = this.committedValue
  }

  #connectInputEvents () {
    if (!this.isConnected || this.inputEventsConnected) return

    const inputRoot = this.$input.shadowRoot
    if (!inputRoot) return
    this.inputEventsConnected = true

    inputRoot.addEventListener('focus', (e) => {
      const input = e.target
      if (input?.id !== 'input') return
      this.committedValue = String(this.value)
      input.select()
    }, true)
    inputRoot.addEventListener('input', (e) => {
      if (e.target?.id !== 'input') return
      this.manualEdit = true
    })
    inputRoot.addEventListener('keydown', (e) => {
      const input = e.target
      if (input?.id !== 'input') return
      if (e.key === 'Enter') {
        e.preventDefault()
        this.#commitValue(input.value)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.#revertValue()
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        this.manualEdit = false
      }
    })
    inputRoot.addEventListener('blur', (e) => {
      const input = e.target
      if (input?.id !== 'input') return
      if (this.manualEdit) {
        this.#commitValue(input.value)
      }
    }, true)

    inputRoot.addEventListener('mousedown', (e) => {
      if (e.target?.id === 'upButton' || e.target?.id === 'downButton') {
        this.manualEdit = false
      }
    }, { capture: true })

    this.$input.addEventListener('change', (e) => {
      e.preventDefault()
      if (this.manualEdit) {
        return
      }
      this.value = e.target.value
      this.committedValue = String(this.value)
      this.#dispatchChange()
    })
  }

  /**
   * @function observedAttributes
   * @returns {any} observed
   */
  static get observedAttributes () {
    return ['value', 'label', 'src', 'size', 'min', 'max', 'step', 'title']
  }

  /**
   * @function attributeChangedCallback
   * @param {string} name
   * @param {string} oldValue
   * @param {string} newValue
   * @returns {void}
   */
  attributeChangedCallback (name, oldValue, newValue) {
    if (oldValue === newValue) return
    switch (name) {
      case 'title':
        {
          const shortcut = this.getAttribute('shortcut')
          this.$div.setAttribute('title', `${t(newValue)} ${shortcut ? `[${t(shortcut)}]` : ''}`)
        }
        break
      case 'src':
        this.$img.setAttribute('src', this.imgPath + '/' + newValue)
        this.$label.remove()
        this.$div.classList.add('imginside')
        break
      case 'size':
      // access to the underlying input box
        this.$input.shadowRoot.getElementById('input').size = newValue
        // below seems mandatory to override the default width style that takes precedence on size
        this.$input.shadowRoot.getElementById('input').style.width = 'unset'
        break
      case 'step':
        this.$input.setAttribute('step', newValue)
        break
      case 'min':
        this.$input.setAttribute('min', newValue)
        break
      case 'max':
        this.$input.setAttribute('max', newValue)
        break
      case 'label':
        this.$label.textContent = t(newValue)
        this.$img.remove()
        break
      case 'value':
        this.$input.value = newValue
        if (!this.manualEdit) {
          this.committedValue = String(newValue)
        }
        break
      default:
        console.error(`unknown attribute: ${name}`)
        break
    }
  }

  /**
   * @function get
   * @returns {any}
   */
  get title () {
    return this.getAttribute('title')
  }

  /**
   * @function set
   * @returns {void}
   */
  set title (value) {
    this.setAttribute('title', value)
  }

  /**
   * @function get
   * @returns {any}
   */
  get label () {
    return this.getAttribute('label')
  }

  /**
   * @function set
   * @returns {void}
   */
  set label (value) {
    this.setAttribute('label', value)
  }

  /**
   * @function get
   * @returns {any}
   */
  get value () {
    return this.$input.value
  }

  /**
   * @function set
   * @returns {void}
   */
  set value (value) {
    this.$input.value = value
    if (!this.manualEdit) {
      this.committedValue = String(value)
    }
  }

  /**
   * @function get
   * @returns {any}
   */
  get src () {
    return this.getAttribute('src')
  }

  /**
   * @function set
   * @returns {void}
   */
  set src (value) {
    this.setAttribute('src', value)
  }

  /**
   * @function get
   * @returns {any}
   */
  get size () {
    return this.getAttribute('size')
  }

  /**
   * @function set
   * @returns {void}
   */
  set size (value) {
    this.setAttribute('size', value)
  }

  /**
   * @function connectedCallback
   * @returns {void}
   */
  connectedCallback () {
    // Descendant connected callbacks render the Elix shadow root synchronously.
    // Wait until the current custom-element reaction stack has completed.
    queueMicrotask(() => this.#connectInputEvents())
  }
}

// Register
customElements.define('se-spin-input', SESpinInput)
