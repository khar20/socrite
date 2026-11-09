import { useState } from 'react'
import { BookOpen, Lightbulb, LockKeyhole, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { authConfigured, authClient } from '../auth'
import { useAuth } from '../auth-context'
import { Button, Field, TextInput } from '../components/ui'

export function LoginPage() {
  const { refresh, error: authError } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = mode === 'sign-in'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name: name.trim(), email, password })
      if (result.error) throw new Error(result.error.message || 'No se pudo completar el acceso.')
      const session = await authClient.getSession()
      const data = session.data as { session?: unknown } | null
      if (!data?.session) {
        setMessage('Revisa tu correo para confirmar la cuenta y luego inicia sesión.')
        setMode('sign-in')
        return
      }
      const profile = await refresh()
      if (!profile) throw new Error('La sesión se inició, pero no se pudo verificar el acceso al servidor.')
      navigate(profile.role === 'teacher' ? '/teacher' : '/access-denied', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-screen">
    <div className="login-aside">
      <div className="brand-lockup"><div className="brand-mark"><Lightbulb size={21} /></div><span>Socrite</span></div>
      <div className="login-story"><span className="story-mark"><BookOpen size={22} /></span><p className="story-kicker">Espacio docente</p><h1>El conocimiento del curso, bajo tu criterio.</h1><p>Organiza tus materiales y estructura académica para acompañar el aprendizaje con evidencia.</p></div>
      <div className="login-aside-foot">Plataforma educativa inteligente</div>
    </div>
    <section className="login-panel">
      <div className="login-card">
        <div className="login-mobile-brand"><div className="brand-mark"><Lightbulb size={20} /></div><strong>Socrite</strong></div>
        <span className="eyebrow">{mode === 'sign-in' ? 'Bienvenido de nuevo' : 'Cuenta docente'}</span>
        <h2>{mode === 'sign-in' ? 'Inicia sesión' : 'Crea tu cuenta'}</h2>
        <p className="muted-text">Accede con tu correo institucional para gestionar tus cursos.</p>
        {!authConfigured && <div className="inline-alert" role="status"><LockKeyhole size={17} /><span>Configura <code>VITE_NEON_AUTH_URL</code> en el archivo <code>.env</code> para habilitar Neon Auth.</span></div>}
        {(error || authError) && <div className="inline-alert alert-error" role="alert">{error || authError}</div>}
        {message && <div className="inline-alert alert-info" role="status">{message}</div>}
        <form onSubmit={submit}>
          {mode === 'sign-up' && <Field label="Nombre completo" required><TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={200} placeholder="Tu nombre" /></Field>}
          <Field label="Correo institucional" required><div className="input-with-icon"><Mail size={16} /><TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="nombre@universidad.edu" /></div></Field>
          <Field label="Contraseña" required><div className="input-with-icon"><LockKeyhole size={16} /><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minLength={8} placeholder="Al menos 8 caracteres" /></div></Field>
          <Button type="submit" size="large" className="login-submit" disabled={busy || !authConfigured}>{busy ? 'Verificando…' : mode === 'sign-in' ? 'Ingresar' : 'Crear cuenta'}</Button>
        </form>
        <div className="login-switch">{mode === 'sign-in' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); setMessage('') }}>{mode === 'sign-in' ? 'Crear cuenta' : 'Iniciar sesión'}</button>
        </div>
        <div className="teacher-note"><span className="teacher-note-dot" />El acceso docente se habilita mediante la lista autorizada por la institución.</div>
      </div>
      <footer className="login-footer">Al continuar, aceptas las políticas de privacidad de tu institución.</footer>
    </section>
  </main>
}

export function AccessDenied() {
  const { profile, signOut } = useAuth()
  return <main className="access-denied"><div className="empty-icon"><LockKeyhole size={22} /></div><h1>Acceso docente no habilitado</h1><p>La cuenta {profile?.email ? <strong>{profile.email}</strong> : 'actual'} no está en la lista autorizada para administrar cursos.</p><p>Solicita acceso al administrador de tu institución. El permiso se actualiza al volver a iniciar sesión.</p><div className="access-actions"><Button variant="outline" onClick={() => void signOut()}>Cerrar sesión</Button><Link className="text-link" to="/login">Volver al acceso</Link></div></main>
}
