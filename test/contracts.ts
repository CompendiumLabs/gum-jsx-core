import assert from 'node:assert/strict'
import {
  em, px, vw, vh, make_measure, normalize_length, measure_length, resolve_length, UnresolvedLengthError,
  resolve_font_size, resolve_line_height, make_size, make_rect, make_point,
  make_insets, resolve_insets, deflate_size, inflate_size, bounds_overflow,
  natural, available, exact, make_request, deflate_request, resolve_sizing,
  prepare_request, finish_size, shape_size, child_measure, define_element, LayoutPass, Rect,
} from '../src/index'
import type { Length, SizeSpec, InsetSpec } from '../src/index'
import { probes } from './fixtures/contracts'

// Test contracts at their boundaries and in small compositions, using literal results.
const tests: Record<string, () => void> = {
  'measurement contexts keep local references independent and derive immutable font and path changes'() {
    const viewport = { width: 800, height: 600 }, reference = { width: 200, height: 0 }
    const parent = make_measure({ font_size: 20, viewport, reference, path: 'Svg/Box[0]' })
    const child = make_measure(parent, { font_size: 10, path: 'Svg/Box[0]/Text[0]' })
    viewport.height = 1200
    reference.width = 400
    assert.ok(Object.isFrozen(parent) && Object.isFrozen(parent.viewport) && Object.isFrozen(parent.reference))
    assert.ok(!Object.isFrozen(viewport) && !Object.isFrozen(reference))
    assert.equal(resolve_length(em(2), parent), 40)
    assert.equal(resolve_length(em(2), child), 20)
    assert.equal(resolve_length(vh(4), child), 24)
    assert.equal(resolve_length(vw(25), child), 200)
    assert.equal(resolve_length(0.5, child, child.reference.width), 100)
    assert.equal(resolve_length(0.5, child, child.reference.height), 0)
    assert.throws(() => resolve_length(0.5, child, undefined, 'gap'), error => {
      assert.ok(error instanceof UnresolvedLengthError)
      assert.equal(error.path, 'Svg/Box[0]/Text[0].gap')
      return true
    })
    assert.deepEqual(measure_length(em(1), make_measure(child, { font_size: undefined })), { value: 1, unit: 'em' })
    assert.throws(() => resolve_insets(vh(1), make_measure(child, { viewport: {} })),
      /Svg\/Box\[0\]\/Text\[0\]\.padding.left.*viewport height/)
  },

  'child measurements inherit typography and viewport while parent references remain explicit'() {
    const child = new Rect({ font_size: vh(5), width: em(2), height: em(1) })
    const Parent = define_element('Parent', (_props, query) => {
      const measure = child_measure(child, query)
      assert.equal(measure.font_size, 30)
      assert.deepEqual(measure.reference, {})
      assert.equal(measure.path, 'Parent/Rect[0]')
      const placed = child_measure(child, query, 2, { width: 200 })
      assert.equal(resolve_length(0.5, placed, placed.reference.width), 100)
      assert.equal(placed.path, 'Parent/Rect[2]')
      assert.equal(query.measure.font_size, 20)
      assert.deepEqual(query.measure.reference, { width: 500 })
      return query.child(child, make_request())
    })
    const fragment = new LayoutPass().layout(new Parent({ font_size: px(20) }), make_request(),
      { viewport: { height: 600 }, reference: { width: 500 } })
    assert.deepEqual(fragment.size, { width: 60, height: 30 })
  },

  'requests treat omitted, undefined, and null axes as natural'() {
    const empty = make_request()
    assert.deepEqual(empty, { width: natural(), height: natural() })
    assert.deepEqual(make_request({ width: undefined, height: null }), empty)
    assert.deepEqual(make_request({ width: null, height: exact(0) }), { width: natural(), height: exact(0) })
    const budget: number | undefined = undefined
    assert.deepEqual(make_request({ width: budget && available(budget), height: available(20) }),
      make_request({ height: available(20) }))
    assert.ok(Object.isFrozen(make_request({ width: null })))
  },

  'lengths retain units and normalize without mutating source values'() {
    const source = { value: 2, unit: 'em' as const }
    const length = normalize_length(source)
    source.value = 3
    assert.deepEqual(length, { value: 2, unit: 'em' })
    assert.deepEqual(normalize_length(0.5), { value: 0.5, unit: 'fraction' })
    assert.deepEqual(normalize_length(length), length)
    assert.ok(Object.isFrozen(length))
    assert.ok(Object.isFrozen(em(2)))
    assert.ok(Object.isFrozen(px(2)))
    assert.ok(!Object.isFrozen(source))

    const measure = { font_size: 16 }
    assert.equal(resolve_length(px(10)), 10)
    assert.equal(resolve_length(em(2), measure, 200), 32)
    assert.equal(resolve_length(0.5, measure, 200), 100)
    assert.equal(resolve_length(-0.5, measure, 200), -100)
  },

  'intrinsic dependencies distinguish missing references from zero'() {
    assert.deepEqual(measure_length(0.5), { value: 0.5, unit: 'fraction' })
    assert.deepEqual(measure_length(em(2)), { value: 2, unit: 'em' })
    assert.equal(resolve_length(0.5, {}, 0), 0)
    for (const length of [0, px(0), em(0)]) assert.equal(resolve_length(length), 0)

    assert.throws(() => resolve_length(0.5, { path: 'root/Box' }, undefined, 'width'), error => {
      assert.ok(error instanceof UnresolvedLengthError)
      assert.equal(error.path, 'root/Box.width')
      assert.deepEqual(error.length, { value: 0.5, unit: 'fraction' })
      assert.match(error.message, /definite fraction reference/)
      return true
    })
    assert.throws(() => resolve_length(em(1)), /definite font size/)
  },

  'font size resolves before local em lengths'() {
    assert.equal(resolve_font_size(), 16)
    assert.equal(resolve_line_height(), 19.2)
    const font_size = resolve_font_size(em(2), { font_size: 16 })
    assert.equal(font_size, 32)
    assert.equal(resolve_font_size(0.5, { font_size }), 16)
    assert.equal(resolve_font_size(px(12), { font_size }), 12)
    assert.equal(resolve_font_size(undefined, { font_size: 0 }), 0)
    assert.equal(resolve_length(em(1), { font_size }), 32)
    assert.equal(resolve_line_height(em(1.5), { font_size }), 48)
    assert.equal(resolve_line_height(1.5, { font_size }), 48)
    assert.equal(resolve_line_height(px(20), { font_size }), 20)
    assert.deepEqual(resolve_insets(em(1), { font_size }), {
      left: 32, top: 32, right: 32, bottom: 32,
    })
  },

  'percentage sizing uses the parent reference across trial allocations'() {
    const spec = Object.freeze({ width: 0.5 })
    const context = Object.freeze({ reference: Object.freeze({ width: 200 }) })
    const sizing = resolve_sizing(spec, context)
    for (const budget of [0, 20, 80, 500]) {
      const request = make_request({ width: available(budget) })
      assert.equal(finish_size(make_size(), request, sizing).width, 100)
    }
    const request = make_request({ width: exact(20) })
    assert.equal(finish_size(make_size(), request, sizing).width, 20)
    assert.equal(sizing.width.preferred, 100)
    assert.throws(() => resolve_sizing(spec), UnresolvedLengthError)
    assert.equal(resolve_sizing(spec, { reference: { width: 0 } }).width.preferred, 0)
  },

  'named insets resolve by axis and cannot produce negative inner sizes'() {
    const context = { font_size: 16, reference: { width: 200, height: 100 } }
    const insets = resolve_insets({ left: 0.1, top: 0.1, right: em(0.5), bottom: px(3) }, context)
    assert.deepEqual(insets, { left: 20, top: 10, right: 8, bottom: 3 })
    assert.deepEqual(inflate_size(make_size(10, 20), insets), { width: 38, height: 33 })
    assert.deepEqual(deflate_size(make_size(10, 20), insets), { width: 0, height: 7 })

    const request = make_request({ width: exact(10), height: available(20) })
    assert.deepEqual(deflate_request(request, insets), {
      width: exact(0), height: available(7),
    })
    assert.deepEqual(deflate_request(make_request(), insets), make_request())
    assert.throws(() => resolve_insets({ top: 0.1 }, {
      path: 'root/Card', reference: { width: 100 },
    }), /root\/Card.padding.top/)
  },

  'inset shorthand objects and tuples retain their side order and length units'() {
    const context = { font_size: 16, reference: { width: 200, height: 100 } }
    const sides: readonly InsetSpec[] = [
      { t: 0.1, b: px(3), l: 0.1, r: em(0.5) },
      [0.1, px(3), 0.1, em(0.5)] as const,
    ]
    for (const spec of sides) {
      assert.deepEqual(resolve_insets(spec, context), { left: 20, top: 10, right: 8, bottom: 3 })
    }
    const axes: readonly InsetSpec[] = [{ h: 0.1, v: em(0.5) }, [0.1, em(0.5)] as const]
    for (const spec of axes) {
      assert.deepEqual(resolve_insets(spec, context), { left: 20, top: 8, right: 20, bottom: 8 })
    }
    assert.deepEqual(resolve_insets({ h: px(3) }), { left: 3, top: 0, right: 3, bottom: 0 })
    assert.deepEqual(resolve_insets({ v: px(4) }), { left: 0, top: 4, right: 0, bottom: 4 })
    assert.deepEqual(resolve_insets({ t: px(1), r: px(2) }), { left: 0, top: 1, right: 2, bottom: 0 })
    for (const spec of [0, {}, [0, 0], [0, 0, 0, 0]] satisfies InsetSpec[]) {
      assert.deepEqual(resolve_insets(spec), make_insets())
    }
  },

  'inset side names override aliases and axis defaults without losing explicit zero'() {
    assert.deepEqual(resolve_insets({ h: px(10), v: px(20), l: px(1), t: px(2), r: px(3), b: px(4),
      left: px(5), top: px(6), right: px(7), bottom: px(8) }),
      { left: 5, top: 6, right: 7, bottom: 8 })
    assert.deepEqual(resolve_insets({ h: px(10), v: px(20), l: 0, top: 0, b: px(4) }),
      { left: 0, top: 0, right: 10, bottom: 4 })
    assert.deepEqual(resolve_insets({ h: px(10), l: px(3), left: 0, right: undefined }),
      { left: 0, top: 0, right: 10, bottom: 0 })
  },

  'inset shorthands preserve reference requirements and side-specific errors'() {
    const context = { path: 'root/Card', reference: { width: 200 } }
    assert.deepEqual(resolve_insets({ h: 0.1 }, context), { left: 20, top: 0, right: 20, bottom: 0 })
    assert.deepEqual(resolve_insets([0.1, 0.2], { reference: { width: 0, height: 0 } }), make_insets())
    for (const spec of [{ v: 0.1 }, [0, 0.1], [0.1, 0, 0, 0]] satisfies InsetSpec[]) {
      assert.throws(() => resolve_insets(spec, context), /root\/Card.padding.top.*definite fraction reference/)
    }
    assert.throws(() => resolve_insets({ h: em(1) }, context), /root\/Card.padding.left.*definite font size/)
    assert.throws(() => resolve_insets([0, px(-1), 0, 0], context), /root\/Card.padding.bottom.*nonnegative/)
    assert.throws(() => resolve_insets({ t: NaN }, context), /root\/Card.padding.top.*finite/)
    assert.throws(() => resolve_insets({ h: Infinity }, context, 'margin'), /root\/Card.margin.left.*finite/)
    for (const spec of [[], [0], [0, 0, 0], [0, 0, 0, 0, 0], Array(2), Array(4), [0, undefined], [null, 0]]) {
      assert.throws(() => resolve_insets(spec as InsetSpec, context),
        /root\/Card.padding.*exactly two \[h, v\] or four \[t, b, l, r\]/)
    }
    for (const spec of [true, false, null, '8px']) {
      assert.throws(() => resolve_insets(spec as unknown as InsetSpec, context), /root\/Card.padding.*expected a length/)
    }
  },

  'resolving shorthand insets does not mutate or freeze caller-owned data'() {
    const length = { value: 2, unit: 'px' as const }
    const spec: [Length, Length] = [length, px(4)]
    const object = { h: length, v: px(4) }
    const tuple_result = resolve_insets(spec), object_result = resolve_insets(object)
    assert.ok(Object.isFrozen(tuple_result) && Object.isFrozen(object_result))
    assert.ok(!Object.isFrozen(spec) && !Object.isFrozen(object) && !Object.isFrozen(length))
    length.value = 10
    spec[1] = px(20)
    object.v = px(30)
    assert.deepEqual(tuple_result, { left: 2, top: 4, right: 2, bottom: 4 })
    assert.deepEqual(object_result, tuple_result)
  },

  'available offers are advisory and exact allocations preserve overflow'() {
    const sizing = resolve_sizing()
    const content = make_size(20, 30)
    const request = make_request({ width: available(10), height: exact(15) })
    const size = finish_size(content, request, sizing)
    assert.deepEqual(size, { width: 20, height: 15 })
    assert.deepEqual(bounds_overflow(size, make_rect(-2, -3, 24, 33)), {
      left: 2, top: 3, right: 2, bottom: 15,
    })
    assert.deepEqual(finish_size(content, make_request(), sizing), content)
    assert.deepEqual(bounds_overflow(size, null), make_insets())
  },

  'explicit sizing is clamped before measurement and yields to exact parents'() {
    const sizing = resolve_sizing({
      width: px(100), min_width: px(150), max_width: px(200), max_height: px(40),
    })
    const request = make_request()
    const prepared = prepare_request(request, sizing)
    assert.deepEqual(prepared, { width: exact(150), height: available(40) })
    assert.deepEqual(prepare_request(prepared, sizing), prepared)
    assert.deepEqual(finish_size(make_size(100, 60), request, sizing), {
      width: 150, height: 40,
    })

    const allocation = make_request({ width: exact(10), height: exact(100) })
    assert.deepEqual(prepare_request(allocation, sizing), allocation)
    assert.deepEqual(finish_size(make_size(), allocation, sizing), {
      width: 10, height: 100,
    })
    const minimum = resolve_sizing({ min_width: px(30) })
    assert.deepEqual(prepare_request(make_request({ width: available(10) }), minimum), {
      width: available(30), height: natural(),
    })
    assert.equal(finish_size(make_size(), make_request(), minimum).width, 30)
  },

  'shape aspect is preferred, with finite natural and zero sizes'() {
    const sizing = resolve_sizing({ aspect: 2 })
    assert.deepEqual(shape_size(make_request(), sizing), { width: 32, height: 16 })
    assert.deepEqual(shape_size(make_request()), { width: 16, height: 16 })
    assert.deepEqual(shape_size(make_request({ width: exact(80) }), sizing), {
      width: 80, height: 40,
    })
    assert.deepEqual(shape_size(make_request({ height: exact(10) }), sizing), {
      width: 20, height: 10,
    })
    assert.deepEqual(shape_size(make_request({
      width: available(80), height: available(10),
    }), sizing), { width: 20, height: 10 })
    assert.deepEqual(shape_size(make_request({ width: available(0) }), sizing), {
      width: 0, height: 0,
    })
    const fixed = resolve_sizing({ width: px(30), height: px(10), aspect: 2 })
    assert.deepEqual(shape_size(make_request(), fixed), { width: 30, height: 10 })
  },

  'geometry and sizing reject invalid numbers at their boundaries'() {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => px(value), RangeError)
      assert.throws(() => em(value), RangeError)
      assert.throws(() => normalize_length(value), RangeError)
      assert.throws(() => make_size(value, 0), RangeError)
      assert.throws(() => make_point(value, 0), RangeError)
    }
    for (const value of [-1, NaN, Infinity]) {
      assert.throws(() => exact(value), RangeError)
      assert.throws(() => available(value), RangeError)
      assert.throws(() => make_insets({ left: value }), RangeError)
    }
    assert.throws(() => resolve_length(em(1), { font_size: Infinity }), RangeError)
    assert.throws(() => resolve_length(1, {}, -1), RangeError)
    assert.throws(() => resolve_length(2, {}, Number.MAX_VALUE), RangeError)
    assert.throws(() => resolve_length(NaN, { path: 'root/child' }, undefined, 'x'), /root\/child.x/)
    assert.throws(() => resolve_length(2, { path: 'root/child' }, Number.MAX_VALUE, 'x'), /root\/child.x/)
    assert.throws(() => normalize_length({ value: 1, unit: 'pt' } as unknown as Length))

    const invalid: SizeSpec[] = [
      { width: px(-1) }, { min_width: px(2), max_width: px(1) },
      { aspect: 0 }, { aspect: -1 }, { aspect: Infinity },
    ]
    for (const spec of invalid) assert.throws(() => resolve_sizing(spec), RangeError)
    assert.throws(() => resolve_font_size(px(-1)), RangeError)
    assert.throws(() => resolve_line_height(px(-1)), RangeError)
    assert.throws(() => resolve_insets(px(-1)), RangeError)
  },

  'requests and resolved sizing own their immutable records'() {
    const axis = { kind: 'available' as const, value: 10 }
    const request = make_request({ width: axis })
    axis.value = 20
    assert.deepEqual(request.width, available(10))
    assert.ok(Object.isFrozen(request))
    assert.ok(Object.isFrozen(request.width))
    const spec = { width: px(30) }
    const sizing = resolve_sizing(spec)
    spec.width = px(40)
    assert.equal(sizing.width.preferred, 30)
    assert.ok(Object.isFrozen(sizing))
    assert.ok(Object.isFrozen(sizing.width))
  },

  'the contract gallery produces the agreed viewport, hugging, and overflow results'() {
    assert.deepEqual(probes.fixed_viewport().size, { width: 640, height: 360 })
    assert.deepEqual(probes.half_width().map(result => result.size.width), [320, 320, 80])
    const hugging = probes.hugging_box()
    assert.deepEqual(hugging.fragment.size, { width: 112, height: 36 })
    assert.deepEqual(hugging.fragment.children[0].offset, { x: 8, y: 8 })
    assert.equal(hugging.fragment.guides.baseline, 23)
    assert.equal(hugging.fragment.children[0].fragment.guides.baseline, 15)
    assert.deepEqual(hugging.fragment.overflow, make_insets())

    const overflow = probes.oversized_padding()
    assert.deepEqual(overflow.inner, { width: exact(0), height: exact(0) })
    assert.deepEqual(overflow.fragment.size, { width: 10, height: 8 })
    assert.deepEqual(overflow.fragment.overflow, { left: 0, top: 0, right: 6, bottom: 8 })
    assert.equal(overflow.fragment.ink, null)
    assert.deepEqual(probes.shape_defaults().exact_width, { width: 80, height: 40 })
    assert.deepEqual(probes.shape_defaults().exact_box, { width: 80, height: 10 })
    assert.deepEqual(probes.shape_defaults().empty, { width: 0, height: 0 })
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} contract checks passed.`)

// Tuple arity and length values are checked for host TypeScript callers too.
if (false) {
  // @ts-expect-error Padding tuples require exactly two or four lengths.
  const three: InsetSpec = [0, 0, 0]
  // @ts-expect-error A side value must be a length, not a string.
  const side: InsetSpec = { t: '8px' }
  // @ts-expect-error An axis value must be a length, not a boolean.
  const axis: InsetSpec = { h: true }
}
