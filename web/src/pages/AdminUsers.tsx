import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, UserRound, UserRoundX } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { PageResult } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, PaginationControls, useToast } from '../components/ui'

type AdminUser = {
  id: string; email: string; full_name: string; role: 'admin' | 'teacher' | 'student'
  is_active: boolean; created_at: string; last_login_at: string | null
}

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [offset, setOffset] = useState(0)
  const limit = 25
  const accounts = useQuery({
    queryKey: ['admin-users', offset],
    queryFn: () => api<PageResult<AdminUser>>(`/admin/users?limit=${limit}&offset=${offset}`),
  })
  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => api(
      `/admin/users/${id}/active`, { method: 'PATCH', body: jsonBody({ is_active }) },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast('Estado de la cuenta actualizado.')
    },
    onError: (error) => toast(error.message, 'error'),
  })

  if (accounts.isLoading) return <LoadingState />
  if (accounts.isError) return <ErrorState message="No se pudo cargar la lista de cuentas." retry={() => void accounts.refetch()} />
  const items = accounts.data!.items

  return <>
    <PageHeader title="Cuentas" description="Consulta quién tiene acceso y suspende cuentas sin borrar su historial académico." />
    <Card><div className="card-heading"><h2>Cuentas de la plataforma</h2><p className="muted-text text-small">{accounts.data!.total} cuentas. Los permisos de docente y administrador se controlan desde la configuración del servidor.</p></div>
      <div className="card-content">
        {!accounts.data!.total ? <EmptyState icon={UserRound} title="Aún no hay cuentas" description="La primera cuenta se crea con el correo de ADMIN_EMAILS." /> : <div className="people-list">{items.map((user) => <div className="person-row admin-user-row" key={user.id}>
          <div className="avatar"><UserRound size={15} /></div>
          <div className="person-copy"><strong>{user.full_name}</strong><span>{user.email} · {user.last_login_at ? `Último acceso ${new Date(user.last_login_at).toLocaleDateString('es')}` : 'Sin inicios de sesión'}</span></div>
          <Badge tone={user.role === 'admin' ? 'info' : user.role === 'teacher' ? 'neutral' : 'success'}>{user.role === 'admin' ? 'Administrador' : user.role === 'teacher' ? 'Docente' : 'Estudiante'}</Badge>
          <Badge tone={user.is_active ? 'success' : 'danger'}>{user.is_active ? 'Activa' : 'Suspendida'}</Badge>
          <Button variant={user.is_active ? 'outline' : 'primary'} size="small" disabled={toggle.isPending} onClick={() => {
            const next = !user.is_active
            if (!window.confirm(`${next ? 'Reactivar' : 'Suspender'} la cuenta de ${user.email}?`)) return
            toggle.mutate({ id: user.id, is_active: next })
          }}>{user.is_active ? <><UserRoundX size={14} />Suspender</> : <><ShieldCheck size={14} />Reactivar</>}</Button>
        </div>)}</div>}
      </div>
    </Card>
    <PaginationControls total={accounts.data!.total} limit={limit} offset={offset} onChange={setOffset} />
  </>
}
