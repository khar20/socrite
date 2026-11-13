import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, Save } from 'lucide-react'
import { api, jsonBody } from '../api'
import { useAuth } from '../auth-context'
import { Button, Card, Field, PageHeader, TextInput, useToast } from '../components/ui'

export function AccountPage() {
  const { profile, refresh } = useAuth()
  const toast = useToast()
  const [names, setNames] = useState({ first_name: '', paternal_last_name: '', maternal_last_name: '' })
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' })

  useEffect(() => {
    if (profile) setNames({
      first_name: profile.first_name,
      paternal_last_name: profile.paternal_last_name,
      maternal_last_name: profile.maternal_last_name,
    })
  }, [profile])

  const saveNames = useMutation({
    mutationFn: () => api('/auth/me', { method: 'PATCH', body: jsonBody(names) }),
    onSuccess: async () => { await refresh(); toast('Datos personales actualizados.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const changePassword = useMutation({
    mutationFn: () => api<void>('/auth/password', {
      method: 'POST',
      body: jsonBody({ current_password: passwords.current_password, new_password: passwords.new_password }),
    }),
    onSuccess: async () => {
      setPasswords({ current_password: '', new_password: '', confirm_password: '' })
      await refresh()
      toast('Contraseña actualizada. Se cerraron tus otras sesiones.')
    },
    onError: (error) => toast(error.message, 'error'),
  })

  return <>
    <PageHeader title="Mi cuenta" description="Actualiza tus datos personales y administra tu contraseña." />
    <div className="account-layout">
      <Card><div className="card-heading"><h2>Datos personales</h2><p className="muted-text text-small">Tu correo no se puede cambiar desde la cuenta.</p></div><form className="card-content settings-form" onSubmit={(event) => { event.preventDefault(); saveNames.mutate() }}>
        <Field label="Correo electrónico"><TextInput value={profile?.email || ''} readOnly /></Field>
        <Field label="Nombres" required><TextInput value={names.first_name} onChange={(event) => setNames({ ...names, first_name: event.target.value.toUpperCase() })} required maxLength={100} /></Field>
        <div className="form-grid">
          <Field label="Apellido paterno" required><TextInput value={names.paternal_last_name} onChange={(event) => setNames({ ...names, paternal_last_name: event.target.value.toUpperCase() })} required maxLength={100} /></Field>
          <Field label="Apellido materno" required><TextInput value={names.maternal_last_name} onChange={(event) => setNames({ ...names, maternal_last_name: event.target.value.toUpperCase() })} required maxLength={100} /></Field>
        </div>
        <div className="form-actions"><Button type="submit" disabled={saveNames.isPending}><Save size={15} />Guardar datos</Button></div>
      </form></Card>
      <Card><div className="card-heading"><h2>Cambiar contraseña</h2><p className="muted-text text-small">Al cambiarla, se cerrarán las demás sesiones de tu cuenta.</p></div><form className="card-content settings-form" onSubmit={(event) => { event.preventDefault(); changePassword.mutate() }}>
        <Field label="Contraseña actual" required><TextInput type="password" autoComplete="current-password" value={passwords.current_password} onChange={(event) => setPasswords({ ...passwords, current_password: event.target.value })} required maxLength={128} /></Field>
        <Field label="Nueva contraseña" hint="Usa al menos 12 caracteres." required><TextInput type="password" autoComplete="new-password" value={passwords.new_password} onChange={(event) => setPasswords({ ...passwords, new_password: event.target.value })} required minLength={12} maxLength={128} /></Field>
        <Field label="Confirma la nueva contraseña" required><TextInput type="password" autoComplete="new-password" value={passwords.confirm_password} onChange={(event) => setPasswords({ ...passwords, confirm_password: event.target.value })} required minLength={12} maxLength={128} /></Field>
        {passwords.new_password && passwords.confirm_password && passwords.new_password !== passwords.confirm_password && <p className="form-error">Las contraseñas no coinciden.</p>}
        <div className="form-actions"><Button type="submit" disabled={changePassword.isPending || passwords.new_password !== passwords.confirm_password}><KeyRound size={15} />Actualizar contraseña</Button></div>
      </form></Card>
    </div>
  </>
}
