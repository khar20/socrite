import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, BookOpen, FileText, Folder, FolderPlus, Link2, MoreHorizontal, Pencil, RotateCw, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Configuration, CurriculumUnit, Folder as MaterialFolder, Material, PageResult, UploadResult } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, PaginationControls, Select, TextInput, useToast } from '../components/ui'

type UploadStatus = 'pending' | 'uploading' | 'verifying' | 'uploaded' | 'failed'
type UploadItem = {
  id: string
  file: File
  name: string
  size: number
  contentType: string
  folderId: string
  unitId: string
  progress: number
  status: UploadStatus
  materialId?: string
  error?: string
}
type UploadTicket = { material_id: string; upload_url: string; headers: Record<string, string> }
const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
}
const uploadTone: Record<UploadStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'neutral',
  uploading: 'info',
  verifying: 'info',
  uploaded: 'success',
  failed: 'danger',
}
const finishedStatuses: UploadStatus[] = ['uploaded', 'failed']

function sendFile(url: string, headers: Record<string, string>, file: File, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value))
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('No se pudo guardar el archivo en el almacenamiento.'))
    request.onerror = () => reject(new Error('Se interrumpió la conexión durante la carga.'))
    request.onabort = () => reject(new Error('Carga cancelada.'))
    request.send(file)
  })
}

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function uploadStatusLabel(item: UploadItem) {
  if (item.status === 'uploading') return `${item.progress}%`
  return { pending: 'Pendiente', verifying: 'Verificando', uploaded: 'Subido', failed: 'Error', uploading: '' }[item.status]
}

function uploadStatusDetail(item: UploadItem) {
  switch (item.status) {
    case 'uploading': return 'Subiendo archivo…'
    case 'verifying': return 'Comprobando el archivo en el almacenamiento…'
    case 'uploaded': return 'El procesamiento continúa en segundo plano.'
    default: return ''
  }
}

export function MaterialsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [folderId, setFolderId] = useState('all')
  const [search, setSearch] = useState('')
  const [unitId, setUnitId] = useState('all')
  const [offset, setOffset] = useState(0)
  const limit = 25
  const [uploadOpen, setUploadOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<MaterialFolder | null>(null)
  const [editing, setEditing] = useState<Material | null>(null)
  const [preview, setPreview] = useState<Material | null>(null)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [linkUnit, setLinkUnit] = useState('')
  const [editName, setEditName] = useState('')
  const [editFolder, setEditFolder] = useState('')
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)

  const foldersQuery = useQuery({ queryKey: ['folders', courseId], queryFn: () => api<MaterialFolder[]>(`/courses/${courseId}/folders`) })
  const query = useQuery({
    queryKey: ['materials', courseId, folderId, unitId, search, offset],
    queryFn: () => {
      const params = new URLSearchParams()
      if (folderId !== 'all') params.set('folder_id', folderId)
      if (unitId !== 'all') params.set('unit_id', unitId)
      if (search) params.set('search', search)
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      return api<PageResult<Material>>(`/courses/${courseId}/materials?${params}`)
    },
    refetchInterval: (current) => current.state.data?.items.some((item) =>
      ['queued', 'processing', 'deleting'].includes(item.status),
    ) ? 5000 : false,
  })
  const curriculum = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`) })
  const configuration = useQuery({ queryKey: ['configuration'], queryFn: () => api<Configuration>('/configuration') })
  const folders = foldersQuery.data || []
  const units = curriculum.data || []
  const materials = query.data?.items || []

  function openUpload() {
    setUploadOpen(true)
  }

  function uploadDestination(item: UploadItem) {
    const folder = folders.find((entry) => entry.id === item.folderId)?.name || 'General'
    const unit = units.find((entry) => entry.id === item.unitId)?.title
    return unit ? `${folder} · ${unit}` : folder
  }

  function updateUploadItem(id: string, patch: Partial<UploadItem>) {
    setUploadItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function addFiles(files: FileList | File[]) {
    if (uploading) return
    const accepted: UploadItem[] = []
    const rejected: string[] = []
    for (const file of Array.from(files)) {
      const extension = file.name.split('.').pop()?.toLowerCase() || ''
      const contentType = mimeByExtension[extension]
      if (!contentType) { rejected.push(`${file.name}: formato no admitido`); continue }
      if (file.size <= 0) { rejected.push(`${file.name}: archivo vacío`); continue }
      if (configuration.data && file.size > configuration.data.max_upload_mb * 1024 * 1024) {
        rejected.push(`${file.name}: supera ${configuration.data.max_upload_mb} MB`)
        continue
      }
      accepted.push({
        id: crypto.randomUUID(), file, name: file.name, size: file.size, contentType,
        folderId: folderId === 'all' ? '' : folderId, unitId: unitId === 'all' ? '' : unitId,
        progress: 0, status: 'pending',
      })
    }
    if (accepted.length) setUploadItems((current) => [...current, ...accepted])
    if (rejected.length) toast(rejected.join(' '), 'error')
  }

  function removeUploadItem(id: string) {
    setUploadItems((current) => current.filter((item) => item.id !== id))
  }

  function clearFinishedUploads() {
    setUploadItems((current) => current.filter((item) => !finishedStatuses.includes(item.status)))
  }

  async function uploadOne(item: UploadItem) {
    updateUploadItem(item.id, { status: 'uploading', progress: 0, error: undefined })
    let materialId: string | null = null
    try {
      const ticket = await api<UploadTicket>(`/courses/${courseId}/materials/uploads`, {
        method: 'POST',
        body: jsonBody({
          name: item.name, content_type: item.contentType, size_bytes: item.size,
          folder_id: item.folderId || null, unit_id: item.unitId || null,
        }),
      })
      materialId = ticket.material_id
      updateUploadItem(item.id, { materialId })
      await sendFile(ticket.upload_url, ticket.headers, item.file,
        (progress) => updateUploadItem(item.id, { progress }))
      updateUploadItem(item.id, { status: 'verifying', progress: 100 })
      const result = await api<UploadResult>(`/materials/${ticket.material_id}/complete`, { method: 'POST' })
      if (result.storage_confirmed === false) throw new Error('El almacenamiento no confirmó el archivo. Vuelve a intentarlo.')
      if ((result.unit_id || null) !== (item.unitId || null)) {
        throw new Error('El archivo se guardó con una unidad distinta a la seleccionada.')
      }
      if (!['queued', 'processing', 'ready'].includes(result.status)) {
        throw new Error('El archivo no quedó en cola de procesamiento.')
      }
      updateUploadItem(item.id, { status: 'uploaded', progress: 100, error: undefined })
      void queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
      void queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
      void queryClient.invalidateQueries({ queryKey: ['course', courseId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      return true
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Error de carga'
      if (materialId) {
        try { await api(`/materials/${materialId}`, { method: 'DELETE' }) }
        catch { message += ' El registro quedó en la biblioteca; elimínalo antes de volver a subir el archivo.' }
      }
      updateUploadItem(item.id, { status: 'failed', error: message })
      return false
    }
  }

  async function startUpload() {
    const pending = uploadItems.filter((item) => item.status === 'pending')
    if (!pending.length || uploading) return
    setUploading(true)
    try {
      let failed = 0
      for (const item of pending) {
        if (!await uploadOne(item)) failed += 1
      }
      if (failed) toast(`${failed} archivo${failed === 1 ? '' : 's'} no se pudo subir. Revisa la cola.`, 'error')
      else toast('Archivos subidos y confirmados en el almacenamiento.')
    } finally {
      setUploading(false)
    }
  }

  const createFolder = useMutation({
    mutationFn: () => api<MaterialFolder>(`/courses/${courseId}/folders`, { method: 'POST', body: jsonBody({ name: newFolder }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['folders', courseId] }); setFolderOpen(false); setNewFolder(''); toast('Carpeta creada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const updateFolder = useMutation({
    mutationFn: () => api<MaterialFolder>(`/folders/${editingFolder!.id}`, { method: 'PATCH', body: jsonBody({ name: newFolder }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
      setFolderOpen(false)
      setEditingFolder(null)
      setNewFolder('')
      toast('Carpeta actualizada.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const createLink = useMutation({
    mutationFn: () => api<Material>(`/courses/${courseId}/materials/links`, { method: 'POST', body: jsonBody({ name: linkName, url: linkUrl, folder_id: folderId === 'all' ? null : folderId, unit_id: linkUnit || null }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['materials', courseId] }); await queryClient.invalidateQueries({ queryKey: ['folders', courseId] }); setLinkOpen(false); setLinkName(''); setLinkUrl(''); toast('Enlace añadido.') },
    onError: (error) => toast(error.message, 'error'),
  })

  async function saveMaterial(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    try {
      await api(`/materials/${editing.id}`, { method: 'PATCH', body: jsonBody({ name: editName, folder_id: editFolder || null, unit_id: editing.unit_id }) })
      await queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
      setEditing(null)
      toast('Material actualizado.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo actualizar.', 'error') }
  }

  async function removeMaterial(material: Material) {
    if (!window.confirm(`¿Eliminar “${material.name}”? Esta acción no se puede deshacer.`)) return
    try {
      const result = await api<{ status?: string }>(`/materials/${material.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
      toast(result?.status === 'deleting' ? 'Eliminación en curso; se reintentará automáticamente.' : 'Material eliminado.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar.', 'error') }
  }

  async function removeFolder(folder: MaterialFolder) {
    if (!window.confirm(`¿Eliminar “${folder.name}”? Sus materiales volverán a “General”.`)) return
    try {
      await api(`/folders/${folder.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
      if (folderId === folder.id) setFolderId('all')
      toast('Carpeta eliminada. Sus materiales siguen en el curso.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar la carpeta.', 'error') }
  }

  async function openFile(material: Material) {
    try {
      if (material.kind === 'link') {
        const { url } = await api<{ url: string }>(`/materials/${material.id}/download-url`)
        window.open(url, '_blank', 'noopener,noreferrer')
      } else {
        const { url } = await api<{ url: string }>(`/materials/${material.id}/download-url?inline=true`)
        if (material.content_type === 'application/pdf') window.open(url, '_blank', 'noopener,noreferrer')
        else setPreview(material)
      }
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo abrir el recurso.', 'error') }
  }

  async function downloadMaterial(material: Material) {
    try {
      const { url } = await api<{ url: string }>(`/materials/${material.id}/download-url`)
      const link = document.createElement('a')
      link.href = url
      link.rel = 'noopener noreferrer'
      link.click()
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo descargar el recurso.', 'error') }
  }

  async function retry(material: Material) {
    try {
      await api(`/materials/${material.id}/retry`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
      toast('Material enviado a procesamiento.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo reintentar.', 'error') }
  }

  async function generateQuestion(material: Material) {
    try {
      await api(`/courses/${courseId}/materials/${material.id}/generate-question`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['questions', courseId] })
      toast('Borrador de pregunta creado.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo generar la pregunta.', 'error') }
  }

  if (query.isLoading || foldersQuery.isLoading || curriculum.isLoading || configuration.isLoading) return <LoadingState />
  if (query.isError || foldersQuery.isError || curriculum.isError || configuration.isError) return <ErrorState message="No pudimos cargar la biblioteca del curso." retry={() => { void query.refetch(); void foldersQuery.refetch() }} />
  const currentFolder = folders.find((folder) => folder.id === folderId)
  const pendingUploads = uploadItems.filter((item) => item.status === 'pending')
  const canUpload = pendingUploads.length > 0 && !uploading
  const hasFinishedUploads = uploadItems.some((item) => finishedStatuses.includes(item.status))

  return <>
    <PageHeader title="Materiales de clase" description="Administra archivos y enlaces que respaldan el estudio y el tutor del curso." actions={<><Button variant="outline" onClick={() => setLinkOpen(true)}><Link2 size={16} />Añadir enlace</Button><Button onClick={openUpload}><UploadCloud size={16} />Subir archivos</Button></>} />
    {!configuration.data!.storage_configured && <div className="inline-alert alert-warning"><Folder size={17} /><span>El almacenamiento de Neon no está configurado. Completa <code>AWS_*</code> y <code>NEON_STORAGE_BUCKET</code> en el servidor.</span></div>}
    {!configuration.data!.ai_configured && <div className="inline-alert alert-info"><Sparkles size={17} /><span>La extracción de texto funciona sin IA. Configura el proveedor para generar embeddings y borradores de preguntas.</span></div>}
    <div className="materials-layout">
      <Card className="materials-folder-sidebar"><div className="card-heading card-heading-row"><h2>Carpetas</h2><Button variant="ghost" size="small" aria-label="Nueva carpeta" onClick={() => { setEditingFolder(null); setNewFolder(''); setFolderOpen(true) }}><FolderPlus size={16} /></Button></div><div className="folder-list">
         <button className={`folder-button${folderId === 'all' ? ' is-active' : ''}`} onClick={() => { setFolderId('all'); setOffset(0) }}><Layers3Icon />Todo el curso<span>{folders.reduce((sum, folder) => sum + folder.count, 0)}</span></button>
         {folders.map((folder) => <FolderRow key={folder.id} folder={folder} selected={folderId === folder.id} onSelect={() => { setFolderId(folder.id); setOffset(0) }} onEdit={() => { setEditingFolder(folder); setNewFolder(folder.name); setFolderOpen(true) }} onDelete={() => void removeFolder(folder)} />)}
      </div></Card>
      <section className="materials-main">
         <div className="materials-toolbar"><div><h2>{folderId === 'all' ? 'Todos los materiales' : currentFolder?.name || 'Carpeta'}</h2><p className="muted-text text-small">{query.data?.total || 0} recurso{query.data?.total === 1 ? '' : 's'}{unitId !== 'all' ? ' en esta unidad' : folderId === 'all' ? ' en este curso' : ' en esta carpeta'}</p></div><div className="materials-filters"><Select aria-label="Filtrar por unidad" value={unitId} onChange={(event) => { setUnitId(event.target.value); setOffset(0) }}><option value="all">Todas las unidades</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</Select><div className="materials-search"><TextInput type="search" aria-label="Buscar material" placeholder="Buscar materiales…" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} /></div></div></div>
        <Card><div className="materials-list">
         {!materials.length ? <EmptyState icon={FileText} title={search ? 'No hay resultados' : query.data!.total ? 'No hay materiales en esta página' : unitId !== 'all' ? 'No hay materiales en esta unidad' : folderId === 'all' ? 'Todavía no hay materiales' : 'Esta carpeta está vacía'} description={search ? 'Prueba con otra búsqueda.' : 'Sube apuntes, guías o presentaciones, o agrega un enlace de referencia.'} action={!search && query.data!.total === 0 && <div className="empty-actions"><Button onClick={openUpload}><UploadCloud size={15} />Subir archivos</Button><Button variant="outline" onClick={() => setLinkOpen(true)}><Link2 size={15} />Añadir enlace</Button></div>} /> : materials.map((material) => <MaterialRow key={material.id} material={material} unitTitle={units.find((unit) => unit.id === material.unit_id)?.title} onOpen={() => void openFile(material)} onEdit={() => { setEditing(material); setEditName(material.name); setEditFolder(material.folder_id || '') }} onDelete={() => void removeMaterial(material)} onRetry={() => void retry(material)} onGenerate={() => void generateQuestion(material)} onDownload={() => void downloadMaterial(material)} aiReady={configuration.data!.ai_configured} />)}
         </div></Card>
         <PaginationControls total={query.data!.total} limit={limit} offset={offset} onChange={setOffset} />
        <p className="materials-help">PDF, DOCX, PPTX y TXT · máximo {configuration.data!.max_upload_mb} MB por archivo. Los enlaces se abren en una pestaña nueva.</p>
      </section>
    </div>

    <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Subir materiales" description="Los archivos se guardan en el almacenamiento privado de Neon y se procesan para su consulta." wide
      onSubmit={(event) => { event.preventDefault(); void startUpload() }}
      submitLabel={uploading ? 'Subiendo…' : 'Subir archivos'} busy={uploading} submitDisabled={!canUpload}>
      <input ref={inputRef} className="visually-hidden" type="file" multiple accept=".pdf,.docx,.pptx,.txt" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = '' }} />
      <button type="button" className="dropzone" disabled={uploading} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}>
        <span className="dropzone-icon"><UploadCloud size={22} /></span>
        <strong>Haz clic o arrastra archivos aquí</strong>
        <small>PDF, DOCX, PPTX o TXT · hasta {configuration.data!.max_upload_mb} MB por archivo</small>
      </button>
      {!!uploadItems.length && <div className="upload-queue">
        <div className="upload-queue-title">
          <strong>Archivos ({uploadItems.length})</strong>
          {hasFinishedUploads && <Button type="button" variant="ghost" size="small" onClick={clearFinishedUploads}>Limpiar terminados</Button>}
        </div>
        {uploadItems.map((item) => <div className="upload-row" key={item.id}>
          <span className="file-type-mark">{item.name.split('.').pop()?.toUpperCase()}</span>
          <div className="upload-row-info">
            <strong title={item.name}>{item.name}</strong>
            {item.status === 'pending' ? <>
              <small className="upload-detail">{formatSize(item.size)}</small>
              <div className="upload-destinations">
                <label className="upload-destination"><span>Carpeta</span><Select aria-label={`Carpeta de ${item.name}`} value={item.folderId} onChange={(event) => updateUploadItem(item.id, { folderId: event.target.value })} disabled={uploading}><option value="">General</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</Select></label>
                <label className="upload-destination"><span>Unidad</span><Select aria-label={`Unidad de ${item.name}`} value={item.unitId} onChange={(event) => updateUploadItem(item.id, { unitId: event.target.value })} disabled={uploading}><option value="">Sin unidad</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</Select></label>
              </div>
            </> : <>
              <small className={item.error ? 'field-error' : 'upload-detail'}>{item.error || (item.status === 'uploaded' ? `Guardado en ${uploadDestination(item)}. ${uploadStatusDetail(item)}` : uploadStatusDetail(item))}</small>
              {item.status === 'uploading' && <div className="progress-track"><i style={{ width: `${item.progress}%` }} /></div>}
            </>}
          </div>
          <div className="upload-row-status">
            <Badge tone={uploadTone[item.status]}>{uploadStatusLabel(item)}</Badge>
            {item.status === 'pending' && <Button type="button" variant="ghost" size="small" aria-label={`Quitar ${item.name}`} onClick={() => removeUploadItem(item.id)}><X size={15} /></Button>}
          </div>
        </div>)}
      </div>}
      <p className="field-hint">Los archivos se suben solo al pulsar “Subir archivos”. Al cerrar este cuadro, las cargas en curso continúan.</p>
    </Modal>

    <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Añadir enlace" description="Guarda un recurso web dentro de la biblioteca." onSubmit={(event) => { event.preventDefault(); createLink.mutate() }} submitLabel="Guardar enlace" busy={createLink.isPending}>
      <Field label="Nombre del recurso" required><TextInput autoFocus value={linkName} onChange={(event) => setLinkName(event.target.value)} required maxLength={255} placeholder="Guía de soporte vital básico" /></Field>
      <Field label="Dirección web" hint="Solo se admiten enlaces HTTP o HTTPS." required><TextInput type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} required placeholder="https://" /></Field>
      <Field label="Carpeta"><Select value={folderId === 'all' ? '' : folderId} onChange={(event) => setFolderId(event.target.value || 'all')}><option value="">General</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</Select></Field>
      <Field label="Unidad"><Select value={linkUnit} onChange={(event) => setLinkUnit(event.target.value)}><option value="">Sin unidad</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</Select></Field>
    </Modal>

    <Modal open={folderOpen} onClose={() => { setFolderOpen(false); setEditingFolder(null) }} title={editingFolder ? 'Editar carpeta' : 'Nueva carpeta'} description={editingFolder ? 'Cambia el nombre de la carpeta.' : 'Agrupa materiales por unidad, tema o tipo de recurso.'} onSubmit={(event) => { event.preventDefault(); editingFolder ? updateFolder.mutate() : createFolder.mutate() }} submitLabel={editingFolder ? 'Guardar cambios' : 'Crear carpeta'} busy={createFolder.isPending || updateFolder.isPending}>
      <Field label="Nombre de carpeta" required><TextInput autoFocus value={newFolder} onChange={(event) => setNewFolder(event.target.value)} required maxLength={160} placeholder="Ej. Unidad 1" /></Field>
    </Modal>

    <Modal open={!!editing} onClose={() => setEditing(null)} title="Organizar material" description="Actualiza el nombre o mueve el recurso a otra carpeta." onSubmit={saveMaterial} submitLabel="Guardar cambios">
      <Field label="Nombre del recurso" required><TextInput autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={255} /></Field>
      <Field label="Carpeta"><Select value={editFolder} onChange={(event) => setEditFolder(event.target.value)}><option value="">General</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</Select></Field>
    </Modal>

    <MaterialPreview material={preview} onClose={() => setPreview(null)} />
  </>
}

function FolderRow({ folder, selected, onSelect, onEdit, onDelete }: {
  folder: MaterialFolder; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return <div className={`folder-row${selected ? ' is-active' : ''}`}>
    <button className={`folder-button${selected ? ' is-active' : ''}`} onClick={onSelect}><Folder size={16} /><span className="folder-name">{folder.name}</span><span>{folder.count}</span></button>
    <div className="row-menu-wrap"><Button variant="ghost" size="small" aria-label={`Acciones de ${folder.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={16} /></Button>{menuOpen && <div className="row-menu"><button onClick={() => { setMenuOpen(false); onEdit() }}><Pencil size={14} />Renombrar</button><button className="danger-text" onClick={() => { setMenuOpen(false); onDelete() }}><Trash2 size={14} />Eliminar carpeta</button></div>}</div>
  </div>
}

function MaterialRow({ material, unitTitle, onOpen, onEdit, onDelete, onRetry, onGenerate, onDownload, aiReady }: {
  material: Material; unitTitle?: string; onOpen: () => void; onEdit: () => void; onDelete: () => void
  onRetry: () => void; onGenerate: () => void; onDownload: () => void; aiReady: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const status = material.status === 'ready' ? { tone: 'success' as const, label: 'Listo' }
    : material.status === 'failed' ? { tone: 'danger' as const, label: 'Error' }
      : { tone: 'warning' as const, label: material.status === 'deleting' ? 'Eliminación pendiente' : material.status === 'queued' ? 'En cola' : material.status === 'processing' ? 'Procesando' : 'Subiendo' }
  return <div className="materials-list-row">
    <button className="material-open" onClick={onOpen} disabled={material.status !== 'ready'}><span className="file-type-mark">{material.kind === 'link' ? 'URL' : material.name.split('.').pop()?.toUpperCase()}</span><span className="material-copy"><strong title={material.name}>{material.name}</strong><small>{material.kind === 'link' ? `Enlace externo${unitTitle ? ` · ${unitTitle}` : ''}` : `${formatSize(material.size_bytes)} · ${unitTitle ? `${unitTitle} · ` : ''}${material.chunk_count} fragmentos`}</small></span></button>
    <div className="material-status"><Badge tone={status.tone}>{status.label}</Badge>{material.status === 'failed' && <Button variant="outline" size="small" onClick={onRetry}><RotateCw size={14} />Reintentar</Button>}{material.status === 'ready' && material.kind === 'file' && aiReady && <><Button variant="outline" size="small" onClick={onRetry}><RotateCw size={14} />Reindexar</Button><Button variant="outline" size="small" onClick={onGenerate}><Sparkles size={14} />Crear pregunta</Button></>}<div className="row-menu-wrap"><Button variant="ghost" size="small" aria-label={`Acciones de ${material.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={17} /></Button>{menuOpen && <div className="row-menu">{material.kind === 'file' && material.status === 'ready' && <button onClick={() => { setMenuOpen(false); onDownload() }}><ArrowDownToLine size={14} />Descargar original</button>}{material.status !== 'deleting' && <button onClick={() => { setMenuOpen(false); onEdit() }}><FileText size={14} />Editar detalles</button>}<button className="danger-text" onClick={() => { setMenuOpen(false); onDelete() }}><Trash2 size={14} />{material.status === 'deleting' ? 'Reintentar eliminación' : 'Eliminar material'}</button></div>}</div></div>
    {material.error && <p className="material-error">{material.error}</p>}
  </div>
}

function MaterialPreview({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const [chunks, setChunks] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { setChunks(null); setError('') }, [material?.id])
  if (!material) return null
  async function load() {
    setLoading(true)
    try { const result = await api<{ chunks: string[] }>(`/materials/${material!.id}/text`); setChunks(result.chunks); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar el texto.') }
    finally { setLoading(false) }
  }
  return <Modal open={!!material} onClose={() => { setChunks(null); setError(''); onClose() }} title={material.name} description={`${material.content_type} · ${formatSize(material.size_bytes)}`} wide>
    {chunks === null && !loading && !error && <div className="preview-intro"><p>Vista previa del texto extraído. La versión original sigue disponible para descargar.</p><Button onClick={() => void load()}><FileText size={15} />Cargar vista previa</Button></div>}
    {loading && <LoadingState label="Cargando texto extraído…" />}
    {error && <div className="inline-alert alert-error">{error}</div>}
    {chunks && (chunks.length ? <article className="text-preview">{chunks.map((chunk, index) => <p key={index}>{chunk}</p>)}</article> : <EmptyState icon={FileText} title="No se extrajo texto" description="Comprueba el archivo original o vuelve a procesarlo." />)}
  </Modal>
}

function Layers3Icon() { return <BookOpen size={16} /> }
