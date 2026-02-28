'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#9333ea',
]

interface AllocationData {
  name: string
  value: number
  pct: number
}

interface Props {
  data: AllocationData[]
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: AllocationData }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-background border rounded shadow px-3 py-2 text-sm">
      <p className="font-medium">{d.name}</p>
      <p className="text-muted-foreground">
        £{d.value.toLocaleString('en-GB', { maximumFractionDigits: 0 })} ({d.pct.toFixed(1)}%)
      </p>
    </div>
  )
}

export function AllocationChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  )
}
