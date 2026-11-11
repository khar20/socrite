import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Copy, Link2, Mail, Plus, Trash2, Users } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { PageResult, Submission } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, PaginationControls, TextArea, TextInput, useToast } from '../components/ui'

type StudentsResult = {
  students: {
    id: string; name: string; email: string; mastery_average: number | null; evidence_count: number
    skills: { id: string; name: string; unit: string; probability: number; observations: number }[]
  }[]
  invitations: { id: string; email: string; expires_at: string }[]
  pagination: { total: number; limit: number; offset: number }
}

export function StudentsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<StudentsResult['students'][number] | null>(null)
  const [offset, setOffset] = useState(0)
  const limit = 25
  const students = useQuery({ queryKey: ['students', courseId, offset], queryFn: () => api<StudentsResult>(`/courses/${courseId}/students?limit=${limit}&offset=${offset}`) })
  const invite = useMutation({
    mutationFn: () => api<{ id: string; email: string; token: string; expires_at: string }>(`/courses/${courseId}/invitations`, {
      method: 'POST', body: jsonBody({ email }),
    }),
    onSuccess: async (result) => {
      setInviteUrl(`${window.location.origin}/join/${result.token}`)
      setEmail('')
      await queryClient.invalidateQueries({ queryKey: ['students', courseId] })
      toast('Enlace de invitación creado. Compártelo con el estudiante.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  if (students.isLoading) return <LoadingState />
  if (students.isError) return <ErrorState message="No pudimos cargar la lista de estudiantes." retry={() => void students.refetch()} />
  const { students: roster, invitations } = students.data!
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); toast('Enlace copiado.') }
    catch { toast('Copia el enlace desde el campo de texto.', 'info') }
  }
  async function revoke(invitationId: string) {
    if (!window.confirm('¿Revocar este enlace de invitación?')) return
    try {
      await api(`/invitations/${invitationId}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['students', courseId] })
      toast('Invitación revocada.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo revocar la invitación.', 'error') }
  }
  return <>
    <PageHeader title="Estudiantes" description="Administra la matrícula y consulta a las personas inscritas." actions={<Button onClick={() => { setInviteUrl(''); setInviteOpen(true) }}><Plus size={16} />Invitar estudiante</Button>} />
    {!students.data!.pagination.total ? <Card><EmptyState icon={Users} title="Aún no hay estudiantes" description="Autoriza el correo del estudiante y luego crea un enlace de invitación." action={<Button onClick={() => { setInviteUrl(''); setInviteOpen(true) }}><Plus size={15} />Crear invitación</Button>} /></Card> : <Card>
       <div className="card-heading card-heading-row"><div><h2>Lista del curso</h2><p className="muted-text text-small">{students.data!.pagination.total} estudiante{students.data!.pagination.total === 1 ? '' : 's'} matriculado{students.data!.pagination.total === 1 ? '' : 's'}.</p></div></div>
       <div className="card-content"><div className="people-list">{roster.length ? roster.map((student) => <div className="person-row" key={student.id}><div className="avatar">{student.name.slice(0, 1).toUpperCase()}</div><div className="person-copy"><strong>{student.name || 'Nombre pendiente'}</strong><span>{student.email}</span></div><span className="student-row-mastery">{student.mastery_average === null ? 'Sin evidencia' : `${Math.round(student.mastery_average * 100)}% dominio estimado · ${student.evidence_count} evidencias`}</span><Badge tone="success">Matriculado</Badge><Button size="small" variant="outline" disabled={!student.skills.length} onClick={() => setSelectedStudent(student)}>Progreso</Button></div>) : <p className="muted-text text-small">No hay estudiantes en esta página.</p>}</div></div>
     </Card>}
    <PaginationControls total={students.data!.pagination.total} limit={limit} offset={offset} onChange={setOffset} />
    {invitations.length > 0 && <Card className="invite-card"><div className="card-heading"><h2>Invitaciones pendientes</h2><p className="muted-text text-small">Cada enlace se puede usar una sola vez y vence en siete días.</p></div><div className="card-content people-list">{invitations.map((item) => <div className="person-row" key={item.id}><div className="avatar"><Link2 size={15} /></div><div className="person-copy"><strong>{item.email}</strong><span>Vence {new Date(item.expires_at).toLocaleDateString('es')}</span></div><Badge tone="warning">Pendiente</Badge><Button size="small" variant="ghost" aria-label="Revocar invitación" onClick={() => void revoke(item.id)}><Trash2 size={15} /></Button></div>)}</div></Card>}
    <div className="inline-alert alert-info page-note"><Mail size={17} /><span>El enlace no se envía por correo automáticamente. Compártelo por un canal institucional y el estudiante deberá verificar una cuenta con el correo invitado.</span></div>
    <Modal open={inviteOpen} onClose={() => { setInviteOpen(false); setInviteUrl('') }} title={inviteUrl ? 'Invitación creada' : 'Invitar estudiante'} description={inviteUrl ? 'Copia este enlace y compártelo con la persona invitada.' : 'El enlace quedará asociado a este correo y vencerá en siete días.'} onSubmit={inviteUrl ? undefined : (event) => { event.preventDefault(); invite.mutate() }} submitLabel={inviteUrl ? undefined : 'Crear enlace'} busy={invite.isPending}>
      {!inviteUrl ? <Field label="Correo institucional del estudiante" required><TextInput autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} placeholder="estudiante@universidad.edu" /></Field> : <><Field label="Enlace de invitación"><TextInput readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></Field><div className="modal-actions"><Button variant="outline" onClick={() => void copyInvite()}><Copy size={15} />Copiar enlace</Button></div></>}
    </Modal>
    <Modal open={!!selectedStudent} onClose={() => setSelectedStudent(null)} title={selectedStudent?.name || 'Progreso del estudiante'} description={selectedStudent ? `${Math.round((selectedStudent.mastery_average || 0) * 100)}% de dominio estimado · ${selectedStudent.evidence_count} evidencias` : undefined} wide>
      {selectedStudent?.skills.map((skill) => <div className="student-skill-detail" key={skill.id}><div className="student-skill-detail-heading"><strong>{skill.name}</strong><span className="muted-text text-small">{Math.round(skill.probability * 100)}% · {skill.observations} evidencias</span></div><p className="muted-text text-small">{skill.unit}</p><div className="progress-track"><i style={{ width: `${Math.round(skill.probability * 100)}%` }} /></div></div>)}
    </Modal>
  </>
}

export function ReviewsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [offset, setOffset] = useState(0)
  const limit = 25
  const reviews = useQuery({ queryKey: ['reviews', courseId, offset], queryFn: () => api<PageResult<Submission>>(`/courses/${courseId}/reviews?limit=${limit}&offset=${offset}`) })
  const [scores, setScores] = useState<Record<string, string>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const review = useMutation({
    mutationFn: ({ id, score, comment }: { id: string; score: number; comment: string }) => api(`/submissions/${id}/review`, { method: 'POST', body: jsonBody({ final_score: score, teacher_comment: comment }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['reviews', courseId] }); await queryClient.invalidateQueries({ queryKey: ['course', courseId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); toast('Evaluación revisada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  if (reviews.isLoading) return <LoadingState />
  if (reviews.isError) return <ErrorState message="No pudimos cargar las entregas." retry={() => void reviews.refetch()} />
  const all = reviews.data!.items
  const pending = all.filter((item) => item.status === 'pending')
  const completed = all.filter((item) => item.status !== 'pending')
  return <>
    <PageHeader title="Revisión de evaluaciones" description="La calificación sugerida ayuda a revisar; la nota final siempre queda bajo tu criterio." />
    {!all.length ? <Card><EmptyState icon={ClipboardCheck} title="No hay entregas para revisar" description="Las respuestas abiertas de tus estudiantes aparecerán aquí cuando empiecen a enviar actividades." /></Card> : <>
      {pending.length > 0 && <section className="review-section"><div className="section-intro"><div><h2>Pendientes</h2><p className="muted-text">{pending.length} respuesta{pending.length === 1 ? '' : 's'} esperan tu revisión.</p></div></div>
        <div className="review-list">{pending.map((submission) => {
          const score = scores[submission.id] ?? String(submission.suggested_score ?? '')
          return <Card key={submission.id}><div className="review-card-heading"><div className="avatar">{submission.student_name.slice(0, 1).toUpperCase()}</div><div className="person-copy"><strong>{submission.student_name}</strong><span>{submission.student_email} · {new Date(submission.created_at).toLocaleDateString('es')}</span></div><Badge tone="warning">Pendiente</Badge></div><div className="review-response"><p>{submission.response}</p></div>{submission.suggested_feedback && <div className="review-ai-suggestion"><strong>Sugerencia automatizada · revisa antes de calificar</strong><p>{submission.suggested_feedback}</p></div>}<div className="review-form"><Field label={`Nota final (0–20)${submission.suggested_score !== null ? ` · sugerencia ${submission.suggested_score}/20` : ''}`} required><TextInput type="number" min="0" max="20" value={score} onChange={(event) => setScores({ ...scores, [submission.id]: event.target.value })} required /></Field><Field label="Comentario para el estudiante"><TextArea rows={2} value={comments[submission.id] ?? ''} onChange={(event) => setComments({ ...comments, [submission.id]: event.target.value })} maxLength={5000} placeholder="Fortalezas, correcciones o próximos pasos…" /></Field><Button disabled={review.isPending || score === ''} onClick={() => review.mutate({ id: submission.id, score: Number(score), comment: comments[submission.id] || '' })}>Guardar revisión</Button></div></Card>
        })}</div></section>}
      {completed.length > 0 && <section className="review-section"><div className="section-intro"><div><h2>Revisadas</h2><p className="muted-text">{completed.length} evaluaciones con nota final en esta página.</p></div></div><Card><div className="review-history">{completed.map((submission) => <div className="review-history-row" key={submission.id}><div className="person-copy"><strong>{submission.student_name}</strong><span>{new Date(submission.created_at).toLocaleDateString('es')} · {submission.teacher_comment || 'Sin comentario'}</span></div><Badge tone="success">{submission.final_score ?? '—'}/20</Badge></div>)}</div></Card></section>}
    </>}
    <PaginationControls total={reviews.data!.total} limit={limit} offset={offset} onChange={setOffset} />
  </>
}
