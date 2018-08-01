import {Model} from "../../model"
import {SizingMode} from "core/enums"
import {empty, margin, padding} from "core/dom"
import * as p from "core/properties"

import {build_views} from "core/build_views"
import {DOMView} from "core/dom_view"

export interface SizeHint {
  width: number
  height: number
  align?: {
    left: number
    right: number
    top: number
    bottom: number
  }
}

export abstract class LayoutDOMView extends DOMView {
  model: LayoutDOM

  protected _idle_notified: boolean = false

  child_views: {[key: string]: LayoutDOMView}

  _left: Variable
  _right: Variable
  _top: Variable
  _bottom: Variable
  _width: Variable
  _height: Variable

  initialize(options: any): void {
    super.initialize(options)

    this._left = new Variable(`${this.toString()}.left`)
    this._right = new Variable(`${this.toString()}.right`)
    this._top = new Variable(`${this.toString()}.top`)
    this._bottom = new Variable(`${this.toString()}.bottom`)
    this._width = new Variable(`${this.toString()}.width`)
    this._height = new Variable(`${this.toString()}.height`)

    this.child_views = {}
    this.build_child_views()
  }

  get layout_bbox(): {[key: string]: number} {
    return {
      top: this._top.value,
      left: this._left.value,
      right: this._right.value,
      bottom: this._bottom.value,
      width: this._width.value,
      height: this._height.value,
    }
  }

  dump_layout(): void {
    const layoutables: {[key: string]: {[key: string]: number}} = {}
    const pending: LayoutDOM[] = [this]

    let obj: LayoutDOM | undefined
    while (obj = pending.shift()) {
      pending.push(...obj.get_layoutable_children())
      layoutables[obj.toString()] = obj.layout_bbox
    }

    console.table(layoutables)
  }

  get_layoutable_models(): LayoutDOM[] {
    return []
  }

  get_layoutable_views(): LayoutDOMView[] {
    return this.model.get_layoutable_models().map((child) => this.child_views[child.id])
  }

  remove(): void {
    for (const model_id in this.child_views) {
      const view = this.child_views[model_id]
      view.remove()
    }
    this.child_views = {}

    // remove on_resize

    super.remove()
  }

  has_finished(): boolean {
    if (!super.has_finished())
      return false

    for (const model_id in this.child_views) {
      const child = this.child_views[model_id]
      if (!child.has_finished())
        return false
    }

    return true
  }

  notify_finished(): void {
    if (!this.is_root)
      super.notify_finished()
    else {
      if (!this._idle_notified && this.has_finished()) {
        if (this.model.document != null) {
          this._idle_notified = true
          this.model.document.notify_idle(this.model)
        }
      }
    }
  }

  protected _available_space(): [number | null, number | null] {
    let measuring: HTMLElement | null = this.el

    while (measuring = measuring.parentElement) {
      // .bk-root element doesn't bring any value
      if (measuring.classList.contains("bk-root"))
        continue

      // we reached <body> element, so use viewport size
      if (measuring == document.body) {
        const {left, right, top, bottom} = margin(document.body)
        const width  = document.documentElement.clientWidth  - left - right
        const height = document.documentElement.clientHeight - top  - bottom
        return [width, height]
      }

      // stop on first element with sensible dimensions
      const {left, right, top, bottom} = padding(measuring)
      const {width, height} = measuring.getBoundingClientRect()

      const inner_width = width - left - right
      const inner_height = height - top - bottom

      if (inner_width > 0 || inner_height > 0)
        return [inner_width > 0 ? inner_width : null, inner_height > 0 ? inner_height : null]
    }

    // this element is detached from DOM
    return [null, null]
  }

  abstract size_hint(): SizeHint

  update_geometry(): void {
    this.el.style.position = this.is_root ? "relative" : "absolute"
    this.el.style.left = `${this._left.value}px`
    this.el.style.top = `${this._top.value}px`
    this.el.style.width = `${this._width.value}px`
    this.el.style.height = `${this._height.value}px`
  }

  after_layout(): void {
    this._has_finished = true
  }

  layout(): void {
    /**
     * Layout's entry point.
     */
    if (!this.is_root)
      this.root.layout()
    else
      this._do_layout()
  }

  protected _do_layout(): void {
    const [width, height] = this._available_space()

    this.model.width
    this.model.height

    // TODO
    this.notify_finished()
  }

  rebuild_child_views(): void {
    this.build_child_views()
    this.layout()
  }

  build_child_views(): void {
    const children = this.model.get_layoutable_children()
    build_views(this.child_views, children, {parent: this})

    empty(this.el)

    for (const child of children) {
      // Look-up the child_view in this.child_views and then append We can't just
      // read from this.child_views because then we don't get guaranteed ordering.
      // Which is a problem in non-box layouts.
      const child_view = this.child_views[child.id]
      this.el.appendChild(child_view.el)
      child_view.render()
    }
  }

  connect_signals(): void {
    super.connect_signals()

    if (this.is_root)
      window.addEventListener("resize", () => this.layout())

    // XXX: this.connect(this.model.change, () => this.layout())
    this.connect(this.model.properties.sizing_mode.change, () => this.layout())
  }

  protected _render_classes(): void {
    this.el.className = "" // removes all classes

    const css_classes = this.css_classes().concat(this.model.css_classes)
    for (const name of css_classes)
      this.el.classList.add(name)
  }

  render(): void {
    this._render_classes()
  }

  // Subclasses should implement this to explain
  // what their height should be in sizing_mode mode.
  abstract get_height(): number

  // Subclasses should implement this to explain
  // what their width should be in sizing_mode mode.
  abstract get_width(): number

  get_width_height(): [number, number] {
    /**
     * Fit into enclosing DOM and preserve original aspect.
     */
    const [parent_width, parent_height] = this._calc_width_height()

    if (parent_width == null && parent_height == null)
      throw new Error("detached element")

    const ar = this.model.get_aspect_ratio()

    if (parent_width != null && parent_height == null)
      return [parent_width, parent_width / ar]

    if (parent_width == null && parent_height != null)
      return [parent_height * ar, parent_height]

    const new_width_1 = parent_width!
    const new_height_1 = parent_width! / ar

    const new_width_2 = parent_height! * ar
    const new_height_2 = parent_height!

    let width: number
    let height: number

    if (new_width_1 < new_width_2) {
      width = new_width_1
      height = new_height_1
    } else {
      width = new_width_2
      height = new_height_2
    }

    return [width, height]
  }
}

export namespace LayoutDOM {
  export interface Attrs extends Model.Attrs {
    height: number
    width: number
    disabled: boolean
    sizing_mode: SizingMode
    css_classes: string[]
  }

  export interface Props extends Model.Props {
    height: p.Property<number>
    width: p.Property<number>
    disabled: p.Property<boolean>
    sizing_mode: p.Property<SizingMode>
    css_classes: p.Property<string[]>
  }
}

export interface LayoutDOM extends LayoutDOM.Attrs {}

export abstract class LayoutDOM extends Model {
  properties: LayoutDOM.Props

  constructor(attrs?: Partial<LayoutDOM.Attrs>) {
    super(attrs)
  }

  static initClass(): void {
    this.prototype.type = "LayoutDOM"

    this.define({
      height:      [ p.Number              ],
      width:       [ p.Number              ],
      disabled:    [ p.Bool,       false   ],
      sizing_mode: [ p.SizingMode, "fixed" ],
      css_classes: [ p.Array,      []      ],
    })
  }
}
LayoutDOM.initClass()
