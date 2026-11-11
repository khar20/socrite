import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, ChevronDown, CircleHelp, ClipboardCheck, FileText, FolderOpen, Home,
  MessageCircle,
  Layers3, LogOut, Menu, Moon, Settings2, ShieldCheck, Sun, Users, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth-context'
import type { Course } from '../types'
import { Badge, LoadingState } from './ui'

const sections = [
  { title: 'Docencia', links: [{ to: '', label: 'Panel docente', icon: Home }] },
  { title: 'Curso', links: [
    { to: 'curriculum', label: 'Estructura académica', icon: Layers3 },
    { to: 'materials', label: 'Materiales de clase', icon: FolderOpen },
    { to: 'students', label: 'Estudiantes', icon: Users },
    { to: 'reviews', label: 'Revisión', icon: ClipboardCheck },
    { to: 'questions', label: 'Banco de preguntas', icon: FileText },
    { to: 'assessments', label: 'Evaluaciones', icon: ClipboardCheck },
  ] },
  { title: 'Administración', links: [
    { to: 'settings', label: 'Configuración', icon: Settings2 },
    { to: 'activity', label: 'Actividad', icon: ShieldCheck },
  ] },
]

const studentSections = [
  { title: 'Aprendizaje', links: [{ to: '', label: 'Inicio', icon: Home }] },
  { title: 'Mi curso', links: [
    { to: 'curriculum', label: 'Ruta de aprendizaje', icon: Layers3 },
    { to: 'materials', label: 'Materiales de clase', icon: FolderOpen },
    { to: 'assessments', label: 'Práctica y evaluaciones', icon: ClipboardCheck },
    { to: 'tutor', label: 'Tutor socrático', icon: MessageCircle },
    { to: 'feedback', label: 'Retroalimentación', icon: FileText },
    { to: 'progress', label: 'Mi progreso', icon: ShieldCheck },
  ] },
]

export function AppLayout({ mode = 'teacher' }: { mode?: 'teacher' | 'student' }) {
  const { profile, signOut } = useAuth()
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [courseMenu, setCourseMenu] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('socrite-theme') || 'light')
  const isTeacher = mode === 'teacher'
  const basePath = isTeacher ? '/teacher' : '/student'
  const navSections = isTeacher ? sections : studentSections
  const coursePath = isTeacher ? 'courses' : 'courses'
  const { data: courses = [], isLoading } = useQuery({
    queryKey: [isTeacher ? 'courses' : 'student-courses'],
    queryFn: () => api<Course[]>(isTeacher ? '/courses' : '/student/courses'),
  })
  const activeCourse = courses.find((course) => course.id === courseId) || courses[0]
  const closeMenu = () => setMobileOpen(false)

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('socrite-theme', next)
    document.documentElement.dataset.theme = next
  }

  const sidebar = <>
    <div className="brand-lockup"><div className="brand-mark"><CircleHelp size={20} /></div><span>Socrite</span><button className="icon-button sidebar-close" onClick={closeMenu} aria-label="Cerrar menú"><X size={17} /></button></div>
    <div className="course-switcher-wrap">
      <button className="course-switcher" onClick={() => setCourseMenu((value) => !value)} aria-expanded={courseMenu}>
        <span className="course-switcher-icon"><BookOpen size={17} /></span>
        <span className="course-switcher-copy"><strong>{activeCourse?.title || 'Tus cursos'}</strong><small>{activeCourse?.code || (isLoading ? 'Cargando…' : 'Selecciona un curso')}</small></span>
        <ChevronDown size={15} />
      </button>
      {courseMenu && <div className="course-menu">
        {courses.map((course) => <button key={course.id} onClick={() => { navigate(`${basePath}/courses/${course.id}`); setCourseMenu(false); closeMenu() }}>
          <BookOpen size={15} /><span>{course.title}</span>{course.id === activeCourse?.id && <Badge tone="success">Activo</Badge>}
        </button>)}
        {!courses.length && <p className="course-menu-empty">{isTeacher ? 'Crea tu primer curso para comenzar.' : 'Únete a un curso para comenzar.'}</p>}
        <Link to={`${basePath}/${coursePath}`} onClick={() => { setCourseMenu(false); closeMenu() }}><Layers3 size={15} />{isTeacher ? 'Gestionar cursos' : 'Ver mis cursos'}</Link>
      </div>}
    </div>
    <nav className="primary-navigation" aria-label="Navegación principal">
      {navSections.map((section) => <div className="nav-section" key={section.title}>
        <div className="nav-section-title">{section.title}</div>
        {section.links.map(({ to, label, icon: Icon }) => {
          const href = to ? (activeCourse ? `${basePath}/courses/${activeCourse.id}/${to}` : `${basePath}/courses`) : basePath
          return <NavLink key={label} end={!to} to={href} onClick={closeMenu}
            className={({ isActive }) => `nav-link${isActive && (!to || activeCourse) ? ' is-active' : ''}`}>
            <Icon size={18} /><span>{label}</span>
          </NavLink>
        })}
      </div>)}
      {isTeacher && <NavLink to="/teacher/courses" onClick={closeMenu} className={({ isActive }) => `nav-link${isActive && !courseId ? ' is-active' : ''}`}><Layers3 size={18} /><span>Cursos</span></NavLink>}
      {profile?.role === 'admin' && <NavLink to="/teacher/admin/students" onClick={closeMenu} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}><Users size={18} /><span>Correos autorizados</span></NavLink>}
    </nav>
    <div className="sidebar-footer">
      <div className="profile-row"><div className="avatar">{(profile?.full_name || profile?.email || 'U').slice(0, 1).toUpperCase()}</div><Link className="profile-copy" to={`${basePath}/account`}><strong>{profile?.full_name || (isTeacher ? 'Docente' : 'Estudiante')}</strong><span>{profile?.email}</span></Link><button className="icon-button" onClick={() => void signOut()} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={16} /></button></div>
    </div>
  </>

  return <div className="application-shell" data-theme={theme}>
    {mobileOpen && <button className="mobile-scrim" onClick={closeMenu} aria-label="Cerrar menú" />}
    <aside className={`app-sidebar${mobileOpen ? ' is-open' : ''}`}>{sidebar}</aside>
    <div className="main-content">
      <header className="app-topbar">
        <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu size={19} /></button>
        <div className="breadcrumb"><span>{isTeacher ? 'Docencia' : 'Aprendizaje'}</span><span aria-hidden="true">/</span><strong>{activeCourse?.title || (isTeacher ? 'Panel docente' : 'Inicio')}</strong></div>
        <div className="topbar-spacer" />
        <Link className="help-link" to={isTeacher ? '/teacher/activity' : `${basePath}${activeCourse ? `/courses/${activeCourse.id}/progress` : ''}`}><ShieldCheck size={15} /><span>{isTeacher ? 'Actividad del curso' : 'Mi progreso'}</span></Link>
        <button className="icon-button theme-button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </header>
      <main className="page-content"><Outlet /></main>
    </div>
  </div>
}

export function PageLoading() {
  return <div className="route-loading"><LoadingState /></div>
}
