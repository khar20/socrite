import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, FileText, Layers3, MessageCircle, Puzzle, Target } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api'
import { ProgressRing } from '../../components/ProgressRing'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import type { PathData, PathSkill } from './types'

function percent(value: number | null) {
  return value === null ? 0 : Math.round(value * 100)
}

function masteryLabel(probability: number | null) {
  if (probability === null) return { label: 'Sin evidencia', tone: 'neutral' as const }
  if (probability >= 0.85) return { label: 'Dominio estimado', tone: 'success' as const }
  if (probability >= 0.5) return { label: 'En progreso', tone: 'info' as const }
  if (probability >= 0.25) return { label: 'Por reforzar', tone: 'warning' as const }
  return { label: 'Inicial', tone: 'danger' as const }
}

export function StudentPathPage() {
  const { courseId = '' } = useParams()
  const toast = useToast()
  const path = useQuery({ queryKey: ['student-path', courseId], queryFn: () => api<PathData>(`/student/courses/${courseId}/path`) })
  const [openUnit, setOpenUnit] = useState<string | null>(null)

  useEffect(() => {
    if (!path.data?.units.length || openUnit) return
    const hash = window.location.hash.replace('#unit-', '')
    const target = path.data.units.find((unit) => unit.id === hash) || path.data.units[0]
    setOpenUnit(target.id)
  }, [path.data, openUnit])

  async function openMaterial(materialId: string) {
    try {
      const { url } = await api<{ url: string }>(`/student/materials/${materialId}/download-url`)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo abrir el material.', 'error')
    }
  }

  if (path.isLoading) return <LoadingState />
  if (path.isError) return <ErrorState message="No pudimos cargar tu ruta." retry={() => void path.refetch()} />
  const units = path.data!.units

  return <div className="student-view">
    <PageHeader
      title="Mi ruta de aprendizaje"
      description={`${units.length} unidades · ${units.reduce((total, unit) => total + unit.skills.length, 0)} habilidades. El dominio es una estimación probabilística basada en tus evidencias.`}
    />
    {!units.length ? <Card><EmptyState icon={Layers3} title="La ruta se está preparando" description="Las unidades aparecerán aquí cuando tu docente publique la estructura del curso." /></Card> : units.map((unit, index) => {
      const isOpen = openUnit === unit.id
      return <Card className={`unit-accordion${isOpen ? ' is-open' : ''}`} id={`unit-${unit.id}`} key={unit.id} style={{ '--i': index } as React.CSSProperties}>
        <button className="unit-toggle" onClick={() => setOpenUnit(isOpen ? null : unit.id)} aria-expanded={isOpen}>
          <ProgressRing value={unit.mastery ?? 0} />
          <span className="unit-toggle-copy">
            <span className="unit-toggle-title">
              <h2>Unidad {unit.position} · {unit.title}</h2>
              {!unit.has_indexed_material && <Badge tone="warning">Sin material indexado</Badge>}
            </span>
            <small className="muted-text">{unit.skills.length} {unit.skills.length === 1 ? 'habilidad' : 'habilidades'} · {unit.materials.length} {unit.materials.length === 1 ? 'material' : 'materiales'}{unit.hours ? ` · ${unit.hours} h` : ''}</small>
          </span>
          <ChevronRight className="unit-chevron" size={18} />
        </button>
        <div className="unit-collapse"><div>
          <div className="unit-body">
            {unit.outcome && <p className="unit-outcome">{unit.outcome}</p>}
            {!!unit.topics.length && <div className="topic-chips">{unit.topics.map((topic) => <span className="topic-chip" key={topic.id}><BookOpen size={12} />{topic.title}</span>)}</div>}
            {unit.excerpt && <blockquote className="unit-excerpt"><FileText size={15} /><span>{unit.excerpt}…</span></blockquote>}

            {!!unit.materials.length && <div className="unit-materials">{unit.materials.map((material) => <button className="unit-material" key={material.id} onClick={() => void openMaterial(material.id)}>
              <span className="unit-material-mark">{material.kind === 'link' ? 'URL' : material.name.split('.').pop()?.toUpperCase().slice(0, 4)}</span>
              <span className="unit-material-name">{material.name}</span>
              <small className="muted-text">{material.status === 'ready' && material.chunk_count ? `${material.chunk_count} fragmentos` : material.status === 'failed' ? 'Texto no disponible' : 'Procesando'}</small>
            </button>)}</div>}

            <div className="skill-list">
              {unit.skills.map((skill) => <SkillRow key={skill.id} skill={skill} courseId={courseId} />)}
              {!unit.skills.length && <p className="muted-text text-small">Esta unidad todavía no tiene habilidades publicadas.</p>}
            </div>

            <div className="unit-actions">
              <Link className="button button-small" to={`/student/courses/${courseId}/practice?unit_id=${unit.id}`}><Target size={14} />Diagnóstico de la unidad</Link>
              <Link className="button button-outline button-small" to={`/student/courses/${courseId}/problems`}><Puzzle size={14} />Problemas de transferencia</Link>
            </div>
          </div>
        </div></div>
      </Card>
    })}
  </div>
}

function SkillRow({ skill, courseId }: { skill: PathSkill; courseId: string }) {
  const status = masteryLabel(skill.probability)
  return <div className="skill-row">
    <span className={`skill-row-icon${(skill.probability ?? 0) >= 0.85 ? ' is-mastered' : ''}`}><Target size={15} /></span>
    <div className="skill-row-copy">
      <strong>{skill.title}</strong>
      {skill.description && <small className="muted-text">{skill.description}</small>}
      <Badge tone={status.tone}>{status.label}</Badge>
    </div>
    <div className="skill-row-bar">
      <div className="progress-track"><i style={{ width: `${percent(skill.probability)}%` }} /></div>
      <span>{percent(skill.probability)}%</span>
    </div>
    <div className="skill-row-actions">
      <Link className="button button-outline button-small" to={`/student/courses/${courseId}/tutor?skill_id=${skill.id}`}><MessageCircle size={14} />Tutor</Link>
      <Link className="button button-outline button-small" to={`/student/courses/${courseId}/practice?skill_id=${skill.id}`}><Target size={14} />Quiz</Link>
    </div>
  </div>
}
