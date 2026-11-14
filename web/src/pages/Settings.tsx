import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, Database, FileQuestion, HardDrive, Save, Settings2, Sparkles } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Configuration, Course } from '../types'
import { Badge, Button, Card, ErrorState, Field, LoadingState, PageHeader, Select, TextArea, TextInput, useToast } from '../components/ui'

type CourseSettings = { course_id: string; socratic_mode: boolean; human_review_required: boolean; attempts_before_solution: number }

export function SettingsPage() {
  const { courseId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const courseQuery = useQuery({ queryKey: ['course', courseId], queryFn: () => api<Course>(`/courses/${courseId}`) })
  const settingsQuery = useQuery({ queryKey: ['course-settings', courseId], queryFn: () => api<CourseSettings>(`/courses/${courseId}/settings`) })
  const configQuery = useQuery({ queryKey: ['configuration'], queryFn: () => api<Configuration>('/configuration') })
  const [course, setCourse] = useState({ title: '', code: '', description: '', credits: 0, academic_period: '', status: 'draft' })
  const [settings, setSettings] = useState({ socratic_mode: true, human_review_required: true, attempts_before_solution: 3 })
  const [generation, setGeneration] = useState({ evaluation_count: 2, practice_count: 2, spaced_repetition_count: 1, transfer_count: 1, question_count: 6 })
  useEffect(() => {
    if (courseQuery.data) setCourse({ title: courseQuery.data.title, code: courseQuery.data.code, description: courseQuery.data.description, credits: courseQuery.data.credits, academic_period: courseQuery.data.academic_period, status: courseQuery.data.status })
  }, [courseQuery.data])
  useEffect(() => {
    if (settingsQuery.data) setSettings({ socratic_mode: settingsQuery.data.socratic_mode, human_review_required: settingsQuery.data.human_review_required, attempts_before_solution: settingsQuery.data.attempts_before_solution })
  }, [settingsQuery.data])
  const saveCourse = useMutation({
    mutationFn: () => api<Course>(`/courses/${courseId}`, { method: 'PATCH', body: jsonBody(course) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['course', courseId] }); await queryClient.invalidateQueries({ queryKey: ['courses'] }); toast('Información del curso guardada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const saveSettings = useMutation({
    mutationFn: () => api<CourseSettings>(`/courses/${courseId}/settings`, { method: 'PUT', body: jsonBody(settings) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['course-settings', courseId] }); toast('Configuración pedagógica guardada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const generate = useMutation({
    mutationFn: () => api<{ activities: { id: string }[] }>(`/courses/${courseId}/assessments/generate-course`, {
      method: 'POST', body: jsonBody({ ...generation, question_types: ['multiple_choice', 'open'] }),
    }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['questions', courseId] }),
      ])
      toast(`${result.activities.length} actividades creadas como borradores. Revísalas antes de publicarlas.`)
      navigate(`/teacher/courses/${courseId}/assessments`)
    },
    onError: (error) => toast(error.message, 'error'),
  })
  if (courseQuery.isLoading || settingsQuery.isLoading || configQuery.isLoading) return <LoadingState />
  if (courseQuery.isError || settingsQuery.isError || configQuery.isError) return <ErrorState message="No pudimos cargar la configuración del curso." retry={() => { void courseQuery.refetch(); void settingsQuery.refetch(); void configQuery.refetch() }} />
  const configuration = configQuery.data!

  return <>
    <PageHeader title="Configuración del curso" description="Actualiza los detalles, organiza las actividades y define las reglas de acompañamiento." />
    <div className="settings-layout">
      <div className="settings-main">
        <Card><div className="card-heading"><h2>Información general</h2><p className="muted-text text-small">Estos datos identifican el curso en la plataforma.</p></div><form className="card-content settings-form" onSubmit={(event) => { event.preventDefault(); saveCourse.mutate() }}>
          <Field label="Nombre del curso" required><TextInput value={course.title} onChange={(event) => setCourse({ ...course, title: event.target.value.toUpperCase() })} required maxLength={200} /></Field>
          <div className="form-grid"><Field label="Código"><TextInput value={course.code} onChange={(event) => setCourse({ ...course, code: event.target.value.toUpperCase() })} maxLength={60} /></Field><Field label="Créditos"><TextInput type="number" min="0" max="60" value={course.credits} onChange={(event) => setCourse({ ...course, credits: Number(event.target.value) })} /></Field></div>
          <Field label="Periodo académico"><TextInput value={course.academic_period} onChange={(event) => setCourse({ ...course, academic_period: event.target.value.toUpperCase() })} maxLength={80} /></Field>
          <Field label="Descripción"><TextArea rows={4} value={course.description} onChange={(event) => setCourse({ ...course, description: event.target.value })} maxLength={5000} /></Field>
          <Field label="Estado"><Select value={course.status} onChange={(event) => setCourse({ ...course, status: event.target.value })}><option value="draft">Borrador</option><option value="active">Activo</option><option value="archived">Archivado</option></Select></Field>
          <div className="form-actions"><Button type="submit" disabled={saveCourse.isPending}><Save size={15} />Guardar cambios</Button></div>
        </form></Card>
        <Card><div className="card-heading"><h2>Técnicas y actividades de aprendizaje</h2><p className="muted-text text-small">Genera borradores con OpenRouter desde la descripción del curso y el texto de tus materiales procesados. Revisa y edita preguntas y evaluaciones antes de publicarlas.</p></div><div className="card-content settings-form">
          <div className="form-grid"><Field label="Evaluaciones"><TextInput type="number" min="0" max="10" value={generation.evaluation_count} onChange={(event) => setGeneration({ ...generation, evaluation_count: Number(event.target.value) })} /></Field><Field label="Prácticas"><TextInput type="number" min="0" max="10" value={generation.practice_count} onChange={(event) => setGeneration({ ...generation, practice_count: Number(event.target.value) })} /></Field><Field label="Repaso espaciado"><TextInput type="number" min="0" max="10" value={generation.spaced_repetition_count} onChange={(event) => setGeneration({ ...generation, spaced_repetition_count: Number(event.target.value) })} /></Field><Field label="Problemas de transferencia"><TextInput type="number" min="0" max="10" value={generation.transfer_count} onChange={(event) => setGeneration({ ...generation, transfer_count: Number(event.target.value) })} /></Field></div>
          <Field label="Preguntas por actividad"><TextInput type="number" min="1" max="12" value={generation.question_count} onChange={(event) => setGeneration({ ...generation, question_count: Number(event.target.value) })} /></Field>
          <div className="inline-alert alert-info form-note"><Sparkles size={16} /><span>La generación usa únicamente la descripción y materiales cargados. Los borradores quedan disponibles para edición y publicación.</span></div>
          <div className="form-actions"><Button onClick={() => generate.mutate()} disabled={!configuration.ai_configured || generate.isPending || Object.entries(generation).some(([key, value]) => key !== 'question_count' && (value < 0 || value > 10)) || generation.evaluation_count + generation.practice_count + generation.spaced_repetition_count + generation.transfer_count < 1 || generation.evaluation_count + generation.practice_count + generation.spaced_repetition_count + generation.transfer_count > 20 || generation.question_count < 1 || generation.question_count > 12}><Sparkles size={15} />{generate.isPending ? 'Generando…' : 'Generar actividades'}</Button><Link className="button button-outline" to={`/teacher/courses/${courseId}/assessments`}><ClipboardCheck size={15} />Revisar actividades</Link><Link className="button button-outline" to={`/teacher/courses/${courseId}/questions`}><FileQuestion size={15} />Banco de preguntas</Link></div>
          {!configuration.ai_configured && <p className="field-hint">Configura OpenRouter en el entorno del servidor para habilitar la generación.</p>}
        </div></Card>
        <Card><div className="card-heading"><h2>Principios pedagógicos</h2><p className="muted-text text-small">Parámetros del tutor y revisión humana.</p></div><form className="card-content settings-form" onSubmit={(event) => { event.preventDefault(); saveSettings.mutate() }}>
          <SettingToggle label="Modo socrático" description="Prioriza preguntas y pistas antes de explicar directamente." checked={settings.socratic_mode} onChange={(value) => setSettings({ ...settings, socratic_mode: value })} />
          <SettingToggle label="Revisión docente obligatoria" description="Las respuestas abiertas esperan revisión humana antes de confirmar una nota." checked={settings.human_review_required} onChange={(value) => setSettings({ ...settings, human_review_required: value })} />
          <Field label="Intentos antes de revelar una referencia" hint="Define cuántas respuestas o pistas se permiten antes de mostrar una explicación de referencia."><Select value={settings.attempts_before_solution} onChange={(event) => setSettings({ ...settings, attempts_before_solution: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value} intentos</option>)}</Select></Field>
          <div className="form-actions"><Button type="submit" disabled={saveSettings.isPending}><Save size={15} />Guardar reglas</Button></div>
        </form></Card>
      </div>
      <aside className="settings-aside">
        <Card><div className="card-heading"><h2>Servicios conectados</h2><p className="muted-text text-small">El estado se obtiene del servidor. Las credenciales nunca se muestran aquí.</p></div><div className="card-content integration-list">
          <Integration icon={Database} title="Base de datos PostgreSQL" description={configuration.database_configured ? 'Conexión estándar de PostgreSQL configurada.' : 'Completa DATABASE_URL en el servidor.'} ready={configuration.database_configured} />
          <Integration icon={Sparkles} title="Proveedor de IA" description={configuration.ai_configured ? `${configuration.ai_provider} · ${configuration.chat_model} · embeddings ${configuration.embedding_model}` : 'Configura AI_BASE_URL, AI_API_KEY y los modelos en el servidor.'} ready={configuration.ai_configured} />
          <Integration icon={HardDrive} title="Neon Object Storage" description={configuration.storage_configured ? `Cargas privadas · máximo ${configuration.max_upload_mb} MB` : 'Configura el bucket y las credenciales de storage en el servidor.'} ready={configuration.storage_configured} />
        </div></Card>
        <Card className="settings-note"><div className="card-content"><div className="note-icon"><Settings2 size={18} /></div><h3>Configuración segura</h3><p>La URL del proveedor, su clave y las credenciales de almacenamiento se administran en el archivo de entorno del servidor, no desde el navegador.</p></div></Card>
      </aside>
    </div>
  </>
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><Check size={12} /></span></label>
}

function Integration({ icon: Icon, title, description, ready }: { icon: React.ComponentType<{ size?: number }>; title: string; description: string; ready: boolean }) {
  return <div className="integration-row"><span className="integration-icon"><Icon size={17} /></span><div><strong>{title}</strong><p>{description}</p></div><Badge tone={ready ? 'success' : 'warning'}>{ready ? 'Conectado' : 'Pendiente'}</Badge></div>
}
