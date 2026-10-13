import { memo } from 'react'
import { arrowEnds, type CanvasElement, type Point } from './controller'

/** 所有箭头画在一层 SVG 里（在卡片下面），坐标就是世界坐标 */
export const ArrowLayer = memo(function ArrowLayer({
  elements,
  selection,
  preview,
}: {
  elements: CanvasElement[]
  selection: ReadonlySet<string>
  preview: [Point, Point] | null
}) {
  const byId = new Map(elements.map((el) => [el.id, el]))
  const arrows = elements.filter((el) => el.type === 'arrow')
  return (
    <svg className="arrow-layer" aria-hidden>
      <defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
        <marker id="arrow-head-selected" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="arrow-head is-selected" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {arrows.map((arrow) => {
        const ends = arrowEnds(arrow, (id) => byId.get(id))
        if (!ends) return null
        const [a, b] = ends
        const d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`
        const selected = selection.has(arrow.id)
        return (
          <g key={arrow.id} className={selected ? 'arrow is-selected' : 'arrow'} data-el-id={arrow.id}>
            <path className="arrow-hit" d={d} />
            <path className="arrow-line" d={d} markerEnd={selected ? 'url(#arrow-head-selected)' : 'url(#arrow-head)'} />
            {selected && (
              <>
                <circle className="arrow-end" cx={a.x} cy={a.y} r={4} />
                <circle className="arrow-end" cx={b.x} cy={b.y} r={4} />
              </>
            )}
          </g>
        )
      })}
      {preview && (
        <path
          className="arrow-line is-preview"
          d={`M ${preview[0].x} ${preview[0].y} L ${preview[1].x} ${preview[1].y}`}
          markerEnd="url(#arrow-head)"
        />
      )}
    </svg>
  )
})
