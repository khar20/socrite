import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, BookOpen, Check, FileText, Folder, FolderPlus, Link2, MoreHorizontal, RotateCw, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Configuration, CurriculumUnit, Folder as MaterialFolder, Material } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Select, TextInput, useToast } from '../components/ui'

type UploadItem = { id: string; name: string; progress: number; status: 'uploading' | 'ready' | 'failed'; error?: string }
type UploadTicket = { material_id: string; upload_url: string; headers: Record<string, string> }
const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
}

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

export function MaterialsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [folderId, setFolderId] = useState('all')
  const [search, setSearch] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [preview, setPreview] = useState<Material | null>(null)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [uploadFolder, setUploadFolder] = useState('')
  const [uploadUnit, setUploadUnit] = useState('')
  const [linkUnit, setLinkUnit] = useState('')
  const [editName, setEditName] = useState('')
  const [editFolder, setEditFolder] = useState('')
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])

  const foldersQuery = useQuery({ queryKey: ['folders', courseId], queryFn: () => api<MaterialFolder[]>(`/courses/${courseId}/folders`) })
  const query = useQuery({
    queryKey: ['materials', courseId, folderId, search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (folderId !== 'all') params.set('folder_id', folderId)
      if (search) params.set('search', search)
      return api<Material[]>(`/courses/${courseId}/materials${params.size ? `?${params}` : ''}`)
    },
  })
  const curriculum = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`) })
  const configuration = useQuery({ queryKey: ['configuration'], queryFn: () => api<Configuration>('/configuration') })
  const folders = foldersQuery.data || []
  const units = curriculum.data || []
  const materials = query.data || []

  async function upload(files: FileList | File[]) {
    const items = Array.from(files)
    if (!items.length) return
    setUploadOpen(true)
    const ids = items.map(() => crypto.randomUUID())
    setUploadItems((current) => [...current, ...items.map((file, index) => ({ id: ids[index], name: file.name, progress: 0, status: 'uploading' as const }))])
    for (let index = 0; index < items.length; index += 1) {
      const file = items[index]
      const id = ids[index]
      const extension = file.name.split('.').pop()?.toLowerCase() || ''
      const contentType = mimeByExtension[extension]
      let materialId: string | null = null
      try {
        if (!contentType || !mimeByExtension[extension]) throw new Error('Formato no admitido. Usa PDF, DOCX, PPTX o TXT.')
        if (configuration.data && file.size > configuration.data.max_upload_mb * 1024 * 1024) throw new Error(`El archivo supera el límite de ${configuration.data.max_upload_mb} MB.`)
        const ticket = await api<UploadTicket>(`/courses/${courseId}/materials/uploads`, {
          method: 'POST', body: jsonBody({ name: file.name, content_type: contentType, size_bytes: file.size, folder_id: uploadFolder || null, unit_id: uploadUnit || null }),
        })
        materialId = ticket.material_id
        await sendFile(ticket.upload_url, ticket.headers, file, (progress) => setUploadItems((current) => current.map((item) => item.id === id ? { ...item, progress } : item)))
        await api<Material>(`/materials/${ticket.material_id}/complete`, { method: 'POST' })
        setUploadItems((current) => current.map((item) => item.id === id ? { ...item, progress: 100, status: 'ready' } : item))
      } catch (error) {
        let message = error instanceof Error ? error.message : 'Error de carga'
        if (materialId) {
          try { await api(`/materials/${materialId}`, { method: 'DELETE' }) }
          catch { message += ' El registro quedó en la biblioteca; elimínalo antes de volver a subir el archivo.' }
        }
        setUploadItems((current) => current.map((item) => item.id === id ? { ...item, status: 'failed', error: message } : item))
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
    await queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
    await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const createFolder = useMutation({
    mutationFn: () => api<MaterialFolder>(`/courses/${courseId}/folders`, { method: 'POST', body: jsonBody({ name: newFolder }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['folders', courseId] }); setFolderOpen(false); setNewFolder(''); toast('Carpeta creada.') },
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
      await api(`/materials/${material.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['materials', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['folders', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
      toast('Material eliminado.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar.', 'error') }
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

  return <>
    <PageHeader title="Materiales de clase" description="Administra archivos y enlaces que respaldan el estudio y el tutor del curso." actions={<><Button variant="outline" onClick={() => setLinkOpen(true)}><Link2 size={16} />Añadir enlace</Button><Button onClick={() => { setUploadFolder(folderId === 'all' ? '' : folderId); setUploadOpen(true); setTimeout(() => inputRef.current?.click(), 0) }}><UploadCloud size={16} />Subir archivos</Button></>} />
    {!configuration.data!.storage_configured && <div className="inline-alert alert-warning"><Folder size={17} /><span>El almacenamiento de Neon no está configurado. Completa <code>AWS_*</code> y <code>NEON_STORAGE_BUCKET</code> en el servidor.</span></div>}
    {!configuration.data!.ai_configured && <div className="inline-alert alert-info"><Sparkles size={17} /><span>La extracción de texto funciona sin IA. Configura el proveedor para generar embeddings y borradores de preguntas.</span></div>}
    <div className="materials-layout">
      <Card className="materials-folder-sidebar"><div className="card-heading card-heading-row"><h2>Carpetas</h2><Button variant="ghost" size="small" aria-label="Nueva carpeta" onClick={() => setFolderOpen(true)}><FolderPlus size={16} /></Button></div><div className="folder-list">
        <button className={`folder-button${folderId === 'all' ? ' is-active' : ''}`} onClick={() => setFolderId('all')}><Layers3Icon />Todo el curso<span>{folders.reduce((sum, folder) => sum + folder.count, 0)}</span></button>
        {folders.map((folder) => <button className={`folder-button${folderId === folder.id ? ' is-active' : ''}`} key={folder.id} onClick={() => setFolderId(folder.id)}><Folder size={16} />{folder.name}<span>{folder.count}</span></button>)}
      </div></Card>
      <section className="materials-main">
        <div className="materials-toolbar"><div><h2>{folderId === 'all' ? 'Todos los materiales' : currentFolder?.name || 'Carpeta'}</h2><p className="muted-text text-small">{materials.length} recurso{materials.length === 1 ? '' : 's'}{folderId === 'all' ? ' en este curso' : ' en esta carpeta'}</p></div><div className="materials-search"><TextInput type="search" aria-label="Buscar material" placeholder="Buscar materiales…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
        <Card><div className="materials-list">
        {!materials.length ? <EmptyState icon={FileText} title={search ? 'No hay resultados' : folderId === 'all' ? 'Todavía no hay materiales' : 'Esta carpeta está vacía'} description={search ? 'Prueba con otra búsqueda.' : 'Sube apuntes, guías o presentaciones, o agrega un enlace de referencia.'} action={!search && <div className="empty-actions"><Button onClick={() => { setUploadFolder(folderId === 'all' ? '' : folderId); setUploadOpen(true); setTimeout(() => inputRef.current?.click(), 0) }}><UploadCloud size={15} />Subir archivos</Button><Button variant="outline" onClick={() => setLinkOpen(true)}><Link2 size={15} />Añadir enlace</Button></div>} /> : materials.map((material) => <MaterialRow key={material.id} material={material} onOpen={() => void openFile(material)} onEdit={() => { setEditing(material); setEditName(material.name); setEditFolder(material.folder_id || '') }} onDelete={() => void removeMaterial(material)} onRetry={() => void retry(material)} onGenerate={() => void generateQuestion(material)} onDownload={() => void downloadMaterial(material)} aiReady={configuration.data!.ai_configured} />)}
        </div></Card>
        <p className="materials-help">PDF, DOCX, PPTX y TXT · máximo {configuration.data!.max_upload_mb} MB por archivo. Los enlaces se abren en una pestaña nueva.</p>
      </section>
    </div>

    <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Subir materiales" description="Los archivos se guardan en el almacenamiento privado de Neon y se procesan para su consulta." wide>
      <div className="upload-controls"><Field label="Carpeta"><Select value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)}><option value="">General</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</Select></Field><Field label="Unidad"><Select value={uploadUnit} onChange={(event) => setUploadUnit(event.target.value)}><option value="">Sin unidad</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</Select></Field><Button variant="outline" onClick={() => inputRef.current?.click()}><UploadCloud size={16} />Elegir archivos</Button></div>
      <input ref={inputRef} className="visually-hidden" type="file" multiple accept=".pdf,.docx,.pptx,.txt" onChange={(event) => { if (event.target.files) void upload(event.target.files); event.target.value = '' }} />
      <button className="dropzone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files) }}><span className="dropzone-icon"><UploadCloud size={22} /></span><strong>Arrastra archivos aquí o selecciónalos</strong><small>PDF, DOCX, PPTX o TXT · hasta {configuration.data!.max_upload_mb} MB por archivo</small></button>
      {!!uploadItems.length && <div className="upload-queue"><div className="upload-queue-title"><strong>Cargas de esta sesión</strong><Button variant="ghost" size="small" onClick={() => setUploadItems((current) => current.filter((item) => item.status === 'uploading'))}>Limpiar terminadas</Button></div>{uploadItems.map((item) => <div className="upload-row" key={item.id}><span className="file-type-mark">{item.name.split('.').pop()?.toUpperCase()}</span><div className="upload-row-info"><strong>{item.name}</strong>{item.error ? <small className="field-error">{item.error}</small> : <div className="progress-track"><i style={{ width: `${item.progress}%` }} /></div>}</div><span className="upload-status">{item.status === 'uploading' ? `${item.progress}%` : item.status === 'ready' ? <Check size={16} /> : <X size={16} />}</span></div>)}</div>}
      <p className="field-hint">Al cerrar este cuadro, las cargas en curso continúan. Los archivos procesados quedarán listados en la biblioteca.</p>
    </Modal>

    <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Añadir enlace" description="Guarda un recurso web dentro de la biblioteca." onSubmit={(event) => { event.preventDefault(); createLink.mutate() }} submitLabel="Guardar enlace" busy={createLink.isPending}>
      <Field label="Nombre del recurso" required><TextInput autoFocus value={linkName} onChange={(event) => setLinkName(event.target.value)} required maxLength={255} placeholder="Guía de soporte vital básico" /></Field>
      <Field label="Dirección web" hint="Solo se admiten enlaces HTTP o HTTPS." required><TextInput type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} required placeholder="https://" /></Field>
      <Field label="Carpeta"><Select value={folderId === 'all' ? '' : folderId} onChange={(event) => setFolderId(event.target.value || 'all')}><option value="">General</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</Select></Field>
      <Field label="Unidad"><Select value={linkUnit} onChange={(event) => setLinkUnit(event.target.value)}><option value="">Sin unidad</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</Select></Field>
    </Modal>

    <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="Nueva carpeta" description="Agrupa materiales por unidad, tema o tipo de recurso." onSubmit={(event) => { event.preventDefault(); createFolder.mutate() }} submitLabel="Crear carpeta" busy={createFolder.isPending}>
      <Field label="Nombre de carpeta" required><TextInput autoFocus value={newFolder} onChange={(event) => setNewFolder(event.target.value)} required maxLength={160} placeholder="Ej. Unidad 1" /></Field>
    </Modal>

    <Modal open={!!editing} onClose={() => setEditing(null)} title="Organizar material" description="Actualiza el nombre o mueve el recurso a otra carpeta." onSubmit={saveMaterial} submitLabel="Guardar cambios">
      <Field label="Nombre del recurso" required><TextInput autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={255} /></Field>
      <Field label="Carpeta"><Select value={editFolder} onChange={(event) => setEditFolder(event.target.value)}><option value="">General</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</Select></Field>
    </Modal>

    <MaterialPreview material={preview} onClose={() => setPreview(null)} />
  </>
}

function MaterialRow({ material, onOpen, onEdit, onDelete, onRetry, onGenerate, onDownload, aiReady }: {
  material: Material; onOpen: () => void; onEdit: () => void; onDelete: () => void
  onRetry: () => void; onGenerate: () => void; onDownload: () => void; aiReady: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const status = material.status === 'ready' ? { tone: 'success' as const, label: 'Listo' }
    : material.status === 'failed' ? { tone: 'danger' as const, label: 'Error' }
      : { tone: 'warning' as const, label: material.status === 'queued' ? 'En cola' : material.status === 'processing' ? 'Procesando' : 'Subiendo' }
  return <div className="materials-list-row">
    <button className="material-open" onClick={onOpen} disabled={material.status !== 'ready'}><span className="file-type-mark">{material.kind === 'link' ? 'URL' : material.name.split('.').pop()?.toUpperCase()}</span><span className="material-copy"><strong title={material.name}>{material.name}</strong><small>{material.kind === 'link' ? 'Enlace externo' : `${formatSize(material.size_bytes)} · ${material.chunk_count} fragmentos`}</small></span></button>
    <div className="material-status"><Badge tone={status.tone}>{status.label}</Badge>{material.status === 'failed' && <Button variant="outline" size="small" onClick={onRetry}><RotateCw size={14} />Reintentar</Button>}{material.status === 'ready' && material.kind === 'file' && aiReady && <Button variant="outline" size="small" onClick={onGenerate}><Sparkles size={14} />Crear pregunta</Button>}<div className="row-menu-wrap"><Button variant="ghost" size="small" aria-label={`Acciones de ${material.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={17} /></Button>{menuOpen && <div className="row-menu">{material.kind === 'file' && material.status === 'ready' && <button onClick={() => { setMenuOpen(false); onDownload() }}><ArrowDownToLine size={14} />Descargar original</button>}<button onClick={() => { setMenuOpen(false); onEdit() }}><FileText size={14} />Editar detalles</button><button className="danger-text" onClick={() => { setMenuOpen(false); onDelete() }}><Trash2 size={14} />Eliminar material</button></div>}</div></div>
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
