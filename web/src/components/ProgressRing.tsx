export function ProgressRing({ value, size = 52, stroke = 5 }: { value: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const color = percent >= 85 ? 'hsl(var(--ok))' : percent >= 50 ? 'hsl(var(--in))' : percent >= 25 ? 'hsl(var(--wn))' : 'hsl(var(--bad))'
  return <span className="progress-ring" style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="progress-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
      <circle className="progress-ring-value" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}
        stroke={color} strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)} />
    </svg>
    <span className="progress-ring-label">{percent}%</span>
  </span>
}
