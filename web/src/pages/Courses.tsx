import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowRight, BookOpen, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Course } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, TextArea, TextInput, useToast } from '../components/ui'

const emptyForm = { title: '', code: '', description: '', credits: '3', academic_period: '' }

export function CoursesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Course | null>(null)
  const [form, setForm] = useState(emptyForm)
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api<Course[]>('/courses') })
  const save = useMutation({
    mutationFn: () => api<Course>(editing ? `/courses/${editing.id}` : '/courses', {
      method: editing ? 'PATCH' : 'POST',
      body: jsonBody({ ...form, credits: Number(form.credits), status: editing?.status || 'draft' }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      setFormOpen(false)
      toast(editing ? 'Curso actualizado.' : 'Curso creado.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const archive = useMutation({
    mutationFn: (course: Course) => api(`/courses/${course.id}`, {
      method: 'PATCH', body: jsonBody({ ...course, status: 'archived' }),
    }),
    onSuccess: async () => { await queryClient.invalidateQueries(); toast('Curso archivado.') },
    onError: (error) => toast(error.message, 'error'),
  })

  function openForm(course?: Course) {
    setEditing(course || null)
    setForm(course ? { title: course.title, code: course.code, description: course.description,
      credits: String(course.credits), academic_period: course.academic_period } : emptyForm)
    setFormOpen(true)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save.mutate()
  }

  if (courses.isLoading) return <LoadingState />
  if (courses.isError) return <ErrorState message="No pudimos obtener tus cursos." retry={() => void courses.refetch()} />
  const list = courses.data!

  return <>
    <PageHeader title="Gestión de cursos" description="Crea y organiza las asignaturas que impartes." actions={<Button onClick={() => openForm()}><Plus size={16} />Nuevo curso</Button>} />
    {!list.length ? <Card><EmptyState icon={BookOpen} title="Crea tu primer curso" description="Cada curso tiene su propia estructura, biblioteca de materiales y configuración pedagógica." action={<Button onClick={() => openForm()}><Plus size={16} />Crear curso</Button>} /></Card> : <div className="course-grid">{list.map((course) => <Card className="course-card" key={course.id}>
      <div className="course-card-top"><div className="course-row-icon"><BookOpen size={20} /></div><Badge tone={course.status === 'active' ? 'success' : course.status === 'archived' ? 'warning' : 'neutral'}>{course.status === 'active' ? 'Activo' : course.status === 'archived' ? 'Archivado' : 'Borrador'}</Badge></div>
      <h2>{course.title}</h2><p className="course-code">{course.code || 'Sin código'}{course.academic_period && ` · ${course.academic_period}`}</p>
      <p className="course-description">{course.description || 'Agrega una descripción para orientar a tus estudiantes.'}</p>
      <div className="course-metrics"><span><Archive size={15} />{course.unit_count} unidades</span><span><BookOpen size={15} />{course.material_count} materiales</span><span>{course.student_count} estudiantes</span></div>
      <div className="course-card-actions"><Link className="button button-primary" to={`/teacher/courses/${course.id}`}>Abrir curso <ArrowRight size={15} /></Link><Button variant="outline" onClick={() => openForm(course)}>Editar</Button>{course.status !== 'archived' && <Button variant="ghost" aria-label={`Archivar ${course.title}`} onClick={() => { if (window.confirm(`¿Archivar “${course.title}”?`)) archive.mutate(course) }}><Archive size={16} /></Button>}</div>
    </Card>)}</div>}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Editar curso' : 'Nuevo curso'} description="Completa la información básica. Puedes agregar la estructura y los materiales después." onSubmit={submit} submitLabel={editing ? 'Guardar cambios' : 'Crear curso'} busy={save.isPending}>
      <Field label="Nombre del curso" required><TextInput autoFocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={2} maxLength={200} placeholder="Ej. Cálculo diferencial" /></Field>
      <div className="form-grid"><Field label="Código"><TextInput value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={60} placeholder="MAT-101" /></Field><Field label="Créditos"><TextInput type="number" min="0" max="60" value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} /></Field></div>
      <Field label="Periodo académico"><TextInput value={form.academic_period} onChange={(event) => setForm({ ...form, academic_period: event.target.value })} maxLength={80} placeholder="2026 · Segundo semestre" /></Field>
      <Field label="Descripción"><TextArea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={5000} placeholder="¿Qué aprenderán los estudiantes en este curso?" /></Field>
    </Modal>
  </>
}
