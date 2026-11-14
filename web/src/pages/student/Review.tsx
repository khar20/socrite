import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CheckCircle2, Eye, Repeat2, Sparkles } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, jsonBody } from '../../api'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import type { PathData } from './types'

type ProgressReview = { skill_id: string; due_at: string; interval_days: number; repetitions: number }
type ProgressSkill = { skill_id: string; skill: string; unit: string; probability: number; observations: number }
type ReviewProgress = { reviews: ProgressReview[]; mastery: ProgressSkill[] }

const RATINGS = [
  { value: 0, label: 'Otra vez' },
  { value: 1, label: 'Difícil' },
  { value: 2, label: 'Bien' },
  { value: 3, label: 'Fácil' },
]

function nextInterval(days: number, rating: number) {
  if (rating === 0) return 1
  if (rating === 1) return Math.max(2, Math.round(days * 1.3))
  if (rating === 2) return Math.max(3, Math.round(days * 2.2))
  return Math.round(days * 3.4) + 1
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

export function StudentReviewPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const progress = useQuery({ queryKey: ['student-progress', courseId], queryFn: () => api<ReviewProgress>(`/student/courses/${courseId}/progress`) })
  const path = useQuery({ queryKey: ['student-path', courseId], queryFn: () => api<PathData>(`/student/courses/${courseId}/path`) })
  const rate = useMutation({
    mutationFn: ({ skillId, rating }: { skillId: string; rating: number }) => api(`/student/reviews/${skillId}/rate?course_id=${courseId}`, { method: 'POST', body: jsonBody({ rating }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['student-progress', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['student-home', courseId] })
      setIndex((value) => value + 1)
      setRevealed(false)
    },
    onError: (error) => toast(error.message, 'error'),
  })
  if (progress.isLoading || path.isLoading) return <LoadingState />
  if (progress.isError || path.isError) return <ErrorState message="No pudimos cargar tus repasos." retry={() => { void progress.refetch(); void path.refetch() }} />

  const now = new Date()
  const reviews = [...progress.data!.reviews]
    .filter((review) => new Date(review.due_at) <= now)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
  const mastery = new Map(progress.data!.mastery.map((item) => [item.skill_id, item]))
  const pathSkills = new Map(path.data!.units.flatMap((unit) => unit.skills.map((skill) => [skill.id, { ...skill, unitTitle: unit.title, excerpt: unit.excerpt }])))
  const current = reviews[index]
  const currentSkill = current ? pathSkills.get(current.skill_id) : undefined
  const currentMastery = current ? mastery.get(current.skill_id) : undefined
  const finished = reviews.length > 0 && index >= reviews.length

  return <div className="student-view">
    <PageHeader title="Repaso espaciado" description="Recupera la idea antes de mirar tus apuntes. La valoración de tu recuerdo define cuándo volverá a aparecer." />

    {!reviews.length ? <Card><EmptyState icon={Repeat2} title="Todo al día" description="No tienes repasos pendientes. Los repasos se programan después de cada evidencia de aprendizaje." action={<Link className="button button-outline" to={`/student/courses/${courseId}/practice`}>Ir a práctica<ArrowRight size={15} /></Link>} /></Card>
      : finished ? <Card><div className="review-finished"><span className="review-finished-icon"><CheckCircle2 size={26} /></span><h2>Repasos completados</h2><p className="muted-text">Terminaste los {reviews.length} repasos pendientes de hoy. Los intervalos se actualizaron según tu valoración.</p><div className="review-finished-actions"><Link className="button" to={`/student/courses/${courseId}/practice`}>Seguir practicando</Link><Link className="button button-outline" to={`/student/courses/${courseId}/progress`}>Ver mi progreso</Link></div></div></Card>
        : current && <Card className="review-stage">
          <div className="review-stage-top">
            <Badge tone="info">Repaso {index + 1} de {reviews.length}</Badge>
            <span className="muted-text text-small">Unidad {currentSkill?.unitTitle || currentMastery?.unit || ''}</span>
          </div>
          <div className="review-prompt">
            <span className="review-prompt-icon"><BookOpen size={22} /></span>
            <p className="muted-text text-small">Sin mirar tus apuntes, explica con tus palabras:</p>
            <h2>{currentMastery?.skill || currentSkill?.title || 'Habilidad'}</h2>
          </div>
          {!revealed ? <Button className="review-reveal" onClick={() => setRevealed(true)}><Eye size={16} />Mostrar respuesta de referencia</Button>
            : <>
              <div className={`review-reference${currentSkill?.excerpt ? '' : ' is-unavailable'}`}>
                <span className="review-reference-label"><Sparkles size={14} />{currentSkill?.excerpt ? 'Referencia del material' : 'Material de referencia no disponible'}</span>
                {currentSkill?.excerpt
                  ? <blockquote>{currentSkill.excerpt}{currentSkill.excerpt.length >= 360 ? '…' : ''}</blockquote>
                  : <p>Consulta los materiales publicados de esta unidad para comprobar tu respuesta. No hay un fragmento indexado disponible para mostrar.</p>}
              </div>
              <div className="review-rating-block">
                <strong>¿Cómo fue tu recuerdo?</strong>
                <div className="review-rate-grid">{RATINGS.map((rating) => <button key={rating.value} disabled={rate.isPending} onClick={() => rate.mutate({ skillId: current.skill_id, rating: rating.value })}>
                  <span>{rating.label}</span>
                  <small className="muted-text">{nextInterval(current.interval_days, rating.value)} d</small>
                </button>)}</div>
              </div>
            </>}
        </Card>}

    {!!progress.data!.reviews.length && <Card>
      <div className="card-heading"><h2>Cola de repasos</h2><p className="muted-text text-small">Todas las habilidades programadas con su intervalo actual.</p></div>
      <div className="card-content review-queue">
        {[...progress.data!.reviews].sort((a, b) => a.due_at.localeCompare(b.due_at)).map((review) => {
          const skill = mastery.get(review.skill_id)
          const due = new Date(review.due_at) <= now
          return <div className="review-queue-row" key={review.skill_id}>
            <div><strong>{skill?.skill || 'Habilidad'}</strong><small className="muted-text">{skill?.unit || ''} · cada {review.interval_days} d</small></div>
            <Badge tone={due ? 'warning' : 'neutral'}>{due ? 'Vence hoy' : formatDate(review.due_at)}</Badge>
          </div>
        })}
      </div>
    </Card>}
  </div>
}
