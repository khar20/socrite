import { useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, Lightbulb, LockKeyhole, Mail } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { useAuth } from '../auth-context'
import type { User } from '../types'
import { Button, Field, TextInput } from '../components/ui'

type Mode = 'sign-in' | 'sign-up'

export function LoginPage() {
  const { refresh, error: authError } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [paternalLastName, setPaternalLastName] = useState('')
  const [maternalLastName, setMaternalLastName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function continueToApp() {
    const user = await refresh()
    if (!user) throw new Error('No se pudo verificar la sesión.')
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo
    if (returnTo?.startsWith('/join/') && user.role === 'student') {
      navigate(returnTo, { replace: true })
      return
    }
    navigate(user.role === 'student' ? '/student' : '/teacher', { replace: true })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const isSignUp = mode === 'sign-up'
      await api<User>(isSignUp ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: jsonBody(isSignUp ? {
          first_name: firstName,
          paternal_last_name: paternalLastName,
          maternal_last_name: maternalLastName,
          email,
          password,
        } : { email, password }),
      })
      await continueToApp()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar el acceso.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-screen">
    <div className="login-aside">
      <div className="brand-lockup"><div className="brand-mark"><Lightbulb size={21} /></div><span>Socrite</span></div>
      <div className="login-story"><span className="story-mark"><BookOpen size={22} /></span><p className="story-kicker">Aprendizaje con propósito</p><h1>El conocimiento del curso, bajo tu criterio.</h1><p>Organiza materiales, estructura académica y actividades para acompañar el aprendizaje con evidencia.</p></div>
      <div className="login-aside-foot">Plataforma educativa inteligente</div>
    </div>
    <section className="login-panel">
      <div className="login-card">
        <div className="login-mobile-brand"><div className="brand-mark"><Lightbulb size={20} /></div><strong>Socrite</strong></div>
        <span className="eyebrow">{mode === 'sign-in' ? 'Bienvenido de nuevo' : 'Cuenta autorizada'}</span>
        <h2>{mode === 'sign-in' ? 'Inicia sesión' : 'Crea tu cuenta'}</h2>
        <p className="muted-text">{mode === 'sign-in' ? 'Ingresa con el correo autorizado para tu cuenta.' : 'El correo debe haber sido autorizado por un administrador o estar habilitado para el equipo docente.'}</p>
        {(error || authError) && <div className="inline-alert alert-error" role="alert">{error || authError}</div>}
        <form onSubmit={submit}>
          {mode === 'sign-up' && <>
            <Field label="Nombres" required><TextInput autoFocus value={firstName} onChange={(event) => setFirstName(event.target.value.toUpperCase())} autoComplete="given-name" required maxLength={100} /></Field>
            <div className="form-grid">
              <Field label="Apellido paterno" required><TextInput value={paternalLastName} onChange={(event) => setPaternalLastName(event.target.value.toUpperCase())} autoComplete="family-name" required maxLength={100} /></Field>
              <Field label="Apellido materno" required><TextInput value={maternalLastName} onChange={(event) => setMaternalLastName(event.target.value.toUpperCase())} required maxLength={100} /></Field>
            </div>
          </>}
          <Field label="Correo electrónico" required><div className="input-with-icon"><Mail size={16} /><TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={320} placeholder="nombre@universidad.edu" /></div></Field>
          <Field label="Contraseña" hint={mode === 'sign-up' ? 'Usa al menos 12 caracteres.' : undefined} required><div className="input-with-icon"><LockKeyhole size={16} /><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minLength={mode === 'sign-up' ? 12 : 1} maxLength={128} /></div></Field>
          <Button type="submit" size="large" className="login-submit" disabled={busy}>{busy ? 'Un momento…' : mode === 'sign-in' ? 'Ingresar' : 'Crear cuenta'}</Button>
        </form>
        <div className="login-switch">{mode === 'sign-in' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button type="button" disabled={busy} onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError('') }}>{mode === 'sign-in' ? 'Crear cuenta' : 'Iniciar sesión'}</button>
        </div>
        <div className="teacher-note"><span className="teacher-note-dot" />La cuenta se activa solo si el correo está autorizado.</div>
      </div>
      <footer className="login-footer">Al continuar, aceptas las políticas de privacidad de tu institución.</footer>
    </section>
  </main>
}

export function AccessDenied() {
  const { profile, signOut } = useAuth()
  return <main className="access-denied"><div className="empty-icon"><LockKeyhole size={22} /></div><h1>Acceso no habilitado</h1><p>La cuenta {profile?.email ? <strong>{profile.email}</strong> : 'actual'} no tiene permisos para esta sección.</p><p>Solicita autorización al administrador de la institución.</p><div className="access-actions"><Button variant="outline" onClick={() => void signOut()}>Cerrar sesión</Button><Link className="text-link" to="/login">Volver al acceso</Link></div></main>
}
