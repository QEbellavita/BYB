import './HubSchematic.css'

export interface HubNode {
  id: string
  label: string
  code: string
  status?: 'good' | 'ochre' | 'danger'
}

const DEFAULT_NODES: HubNode[] = [
  { id: 'rules', label: 'Business Rules', code: 'B', status: 'good' },
  { id: 'risk', label: 'Risk Register', code: 'J', status: 'good' },
  { id: 'docs', label: 'Documents', code: 'D', status: 'good' },
  { id: 'complaints', label: 'Complaints', code: 'E', status: 'ochre' },
  { id: 'processes', label: 'Processes', code: 'C', status: 'good' },
  { id: 'people', label: 'People', code: 'O', status: 'good' },
  { id: 'compliance', label: 'Compliance', code: 'I', status: 'good' },
  { id: 'finance', label: 'Finance', code: 'M', status: 'ochre' },
]

const W = 640
const H = 520
const CX = W / 2
const CY = H / 2
const RX = 244
const RY = 188

/**
 * The Context Hub drawn as an engineering schematic: every module node
 * connects to one ochre core. The single source of truth, made literal.
 */
export function HubSchematic({
  nodes = DEFAULT_NODES,
  variant = 'hero',
}: {
  nodes?: HubNode[]
  variant?: 'hero' | 'compact'
}) {
  const placed = nodes.map((n, i) => {
    // start at top, distribute clockwise
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length
    const x = CX + RX * Math.cos(angle)
    const y = CY + RY * Math.sin(angle)
    return { ...n, x, y, angle }
  })

  return (
    <svg
      className={`hub hub--${variant}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Context Hub schematic: business modules connecting to a single source of truth"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* faint orbit guide */}
      <ellipse
        className="hub__orbit"
        cx={CX}
        cy={CY}
        rx={RX}
        ry={RY}
      />

      {/* connection lines hub -> node */}
      {placed.map((n, i) => (
        <line
          key={`l-${n.id}`}
          className="hub__link"
          x1={CX}
          y1={CY}
          x2={n.x}
          y2={n.y}
          style={{ animationDelay: `${0.25 + i * 0.07}s` }}
        />
      ))}

      {/* module nodes */}
      {placed.map((n, i) => {
        const isVertical = Math.abs(n.x - CX) <= 8
        const anchorLeft = n.x < CX - 8
        // Vertical (top/bottom) nodes stack their labels clear of the circle;
        // side/diagonal nodes sit their labels beside the circle.
        let tx: number
        let anchor: 'start' | 'middle' | 'end'
        let codeY: number
        let labelY: number
        if (isVertical) {
          tx = n.x
          anchor = 'middle'
          if (n.y < CY) { codeY = n.y - 26; labelY = n.y - 13 }
          else { codeY = n.y + 22; labelY = n.y + 35 }
        } else {
          tx = anchorLeft ? n.x - 16 : n.x + 16
          anchor = anchorLeft ? 'end' : 'start'
          codeY = n.y - 4
          labelY = n.y + 9
        }
        return (
          <g
            key={`n-${n.id}`}
            className={`hub__node hub__node--${n.status ?? 'good'}`}
            style={{ animationDelay: `${0.55 + i * 0.07}s` }}
          >
            <circle className="hub__node-ring" cx={n.x} cy={n.y} r={10} />
            <circle className="hub__node-core" cx={n.x} cy={n.y} r={3.4} />
            <text className="hub__node-code" x={tx} y={codeY} textAnchor={anchor}>
              MOD-{n.code}
            </text>
            <text className="hub__node-label" x={tx} y={labelY} textAnchor={anchor}>
              {n.label}
            </text>
          </g>
        )
      })}

      {/* hub core ◉ */}
      <g className="hub__core">
        <circle className="hub__pulse" cx={CX} cy={CY} r={34} />
        <circle className="hub__core-outer" cx={CX} cy={CY} r={34} />
        <circle className="hub__core-mid" cx={CX} cy={CY} r={20} />
        <circle className="hub__core-dot" cx={CX} cy={CY} r={8} />
        {/* crosshair through core */}
        <line className="hub__cross" x1={CX - 52} y1={CY} x2={CX - 40} y2={CY} />
        <line className="hub__cross" x1={CX + 40} y1={CY} x2={CX + 52} y2={CY} />
        <line className="hub__cross" x1={CX} y1={CY - 52} x2={CX} y2={CY - 40} />
        <line className="hub__cross" x1={CX} y1={CY + 40} x2={CX} y2={CY + 52} />
      </g>
      <text className="hub__core-label" x={CX} y={CY + 64} textAnchor="middle">
        CONTEXT HUB
      </text>
    </svg>
  )
}
