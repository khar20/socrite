import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Plus, Trash2, Users } from 'lucide-react'
import { api, jsonBody } from '../api'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, TextInput, useToast } from '../components/ui'

type AllowlistEntry = { id: string; email: string; created_at: string; registered: boolean; student_name: string | null }

export function StudentAllowlistPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const entries = useQuery({
    queryKey: ['student-allowlist'],
    queryFn: () => api<AllowlistEntry[]>('/admin/student-allowlist'),
  })
  const add = useMutation({
    mutationFn: () => api<AllowlistEntry>('/admin/student-allowlist', { method: 'POST', body: jsonBody({ email }) }),
    onSuccess: async () => {
      setEmail('')
      await queryClient.invalidateQueries({ queryKey: ['student-allowlist'] })
      toast('Correo autorizado para registrarse como estudiante.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/admin/student-allowlist/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['student-allowlist'] })
      toast('Correo eliminado; la cuenta asociada fue desactivada y sus sesiones revocadas.')
    },
    onError: (error) => toast(error.message, 'error'),
  })

  if (entries.isLoading) return <LoadingState />
  if (entries.isError) return <ErrorState message="No se pudo cargar la lista de correos autorizados." retry={() => void entries.refetch()} />

  return <>
    <PageHeader title="Correos autorizados" description="Solo los correos de esta lista pueden crear cuentas de estudiante." />
    <Card><div className="card-heading"><h2>Autorizar estudiante</h2><p className="muted-text text-small">Al retirar un correo, la cuenta existente se desactiva y se cierran sus sesiones.</p></div>
      <form className="card-content allowlist-add-form" onSubmit={(event) => { event.preventDefault(); add.mutate() }}>
        <Field label="Correo del estudiante" required><TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} placeholder="estudiante@universidad.edu" /></Field>
        <Button type="submit" disabled={add.isPending}><Plus size={15} />Autorizar correo</Button>
      </form>
    </Card>
    <Card className="allowlist-card"><div className="card-heading"><h2>Lista de estudiantes</h2><p className="muted-text text-small">{entries.data!.length} correos autorizados</p></div>
      <div className="card-content">
        {!entries.data!.length ? <EmptyState icon={Users} title="La lista está vacía" description="Agrega un correo para permitir que esa persona cree su cuenta de estudiante." /> : <div className="people-list">{entries.data!.map((entry) => <div className="person-row allowlist-row" key={entry.id}>
          <div className="avatar"><Mail size={15} /></div>
          <div className="person-copy"><strong>{entry.student_name || entry.email}</strong><span>{entry.student_name ? entry.email : `Autorizado ${new Date(entry.created_at).toLocaleDateString('es')}`}</span></div>
          <Badge tone={entry.registered ? 'success' : 'warning'}>{entry.registered ? 'Cuenta activa' : 'Sin registrar'}</Badge>
          <Button variant="ghost" size="small" aria-label={`Retirar autorización de ${entry.email}`} disabled={remove.isPending} onClick={() => {
            if (window.confirm(`¿Retirar el acceso de ${entry.email}? La cuenta existente se desactivará.`)) remove.mutate(entry.id)
          }}><Trash2 size={15} /></Button>
        </div>)}</div>}
      </div>
    </Card>
  </>
}
