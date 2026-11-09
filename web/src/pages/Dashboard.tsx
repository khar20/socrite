import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CheckCircle2, Clock3, FileText, Layers3, Plus, Users } from 'lucide-react'
import { api } from '../api'
import type { Course, DashboardData } from '../types'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Stat } from '../components/ui'

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
}

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/teacher/dashboard') })
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api<Course[]>('/courses') })
  if (dashboard.isLoading || courses.isLoading) return <LoadingState />
  if (dashboard.isError || courses.isError) return <ErrorState message="Revisa tu conexión e inténtalo de nuevo." retry={() => { void dashboard.refetch(); void courses.refetch() }} />
  const data = dashboard.data!
  const list = courses.data!

  return <>
    <PageHeader title="Panel docente" description="Organiza el curso y revisa qué está listo para tus estudiantes." actions={<Link className="button button-primary" to="/teacher/courses"><Plus size={16} />Nuevo curso</Link>} />
    <div className="stats-grid">
      <Stat icon={BookOpen} label="Cursos" value={data.course_count} detail="cursos que administras" />
      <Stat icon={FileText} label="Materiales listos" value={data.ready_material_count} detail={`${data.material_count} en total`} />
      <Stat icon={Users} label="Estudiantes" value={data.student_count} detail="matriculados en tus cursos" />
      <Stat icon={Clock3} label="Revisiones pendientes" value={data.pending_reviews} detail="respuestas abiertas" />
    </div>

    <div className="dashboard-columns">
      <Card>
        <div className="card-heading card-heading-row"><div><h2>Tus cursos</h2><p className="muted-text text-small">Continúa desde el contenido que estás preparando.</p></div><Link className="subtle-link" to="/teacher/courses">Ver todos <ArrowRight size={14} /></Link></div>
        <div className="card-content course-list">
          {!list.length ? <EmptyState icon={BookOpen} title="Aún no tienes cursos" description="Crea un curso para organizar su estructura académica y reunir los materiales." action={<Link className="button button-primary" to="/teacher/courses"><Plus size={15} />Crear curso</Link>} /> : list.slice(0, 5).map((course) => <CourseRow course={course} key={course.id} />)}
        </div>
      </Card>
      <Card>
        <div className="card-heading"><h2>Actividad reciente</h2><p className="muted-text text-small">Cambios y acciones registradas en tu cuenta.</p></div>
        <div className="card-content">
          {!data.recent_activity.length ? <EmptyState icon={CheckCircle2} title="Sin actividad todavía" description="Las acciones que realices en tus cursos aparecerán aquí." /> : <div className="activity-list">{data.recent_activity.map((event) => <div className="activity-item" key={event.id}><span className="activity-marker" /><div><strong>{event.action.replaceAll('.', ' · ')}</strong><time>{dateLabel(event.created_at)}</time></div></div>)}</div>}
        </div>
      </Card>
    </div>
    {!!list.length && <section className="readiness-section"><div className="section-intro"><div><h2>Próximos pasos</h2><p className="muted-text">Completa lo básico antes de abrir el curso.</p></div></div><div className="readiness-list">{[
      { icon: Layers3, title: 'Define la estructura académica', detail: 'Agrega unidades, temas y habilidades.', route: 'curriculum' },
      { icon: FileText, title: 'Reúne los materiales', detail: 'Sube documentos o añade enlaces.', route: 'materials' },
      { icon: Users, title: 'Incorpora estudiantes', detail: 'La lista se completará cuando se habilite la matrícula.', route: 'students' },
    ].map((item) => <Link className="readiness-item" key={item.route} to={`/teacher/courses/${list[0].id}/${item.route}`}><span className="readiness-icon"><item.icon size={18} /></span><span className="readiness-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={16} /></Link>)}</div></section>}
  </>
}

function CourseRow({ course }: { course: Course }) {
  return <Link className="course-row" to={`/teacher/courses/${course.id}`}>
    <div className="course-row-icon"><BookOpen size={18} /></div>
    <div className="course-row-copy"><strong>{course.title}</strong><span>{course.code || 'Sin código'} · {course.unit_count} unidades · {course.material_count} materiales</span></div>
    <Badge tone={course.status === 'active' ? 'success' : 'neutral'}>{course.status === 'active' ? 'Activo' : 'Borrador'}</Badge>
    <ArrowRight size={16} className="muted-text" />
  </Link>
}
