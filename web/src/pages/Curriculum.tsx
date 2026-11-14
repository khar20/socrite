import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, BookOpen, Check, Layers3, Plus, Sparkles, Target, Trash2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { CurriculumUnit } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, TextArea, TextInput, useToast } from '../components/ui'

type EditState = { unit?: CurriculumUnit; kind: 'unit' | 'topic' | 'skill'; itemId?: string }

export function CurriculumPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editor, setEditor] = useState<EditState | null>(null)
  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [generationCounts, setGenerationCounts] = useState({ topic_count: 4, skill_count: 4 })
  const curriculum = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`) })
  const generateContent = useMutation({
    mutationFn: (unitId: string) => api<{ items: { type: string; title: string }[] }>(
      `/courses/${courseId}/units/${unitId}/generate-content`,
      { method: 'POST', body: jsonBody(generationCounts) },
    ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['curriculum', courseId] })
      toast(`${result.items.length} temas y habilidades guardados como borradores.`)
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const publishContent = useMutation({
    mutationFn: ({ kind, id }: { kind: 'topic' | 'skill'; id: string }) => api(
      `/${kind === 'topic' ? 'topics' : 'skills'}/${id}/publish`, { method: 'PATCH' },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['curriculum', courseId] })
      toast('Contenido aprobado y publicado para estudiantes.')
    },
    onError: (error) => toast(error.message, 'error'),
  })

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || !title.trim()) return
    setBusy(true)
    try {
      const unit = editor.unit
      if (editor.kind === 'unit') {
        const body = { title: title.trim(), outcome: outcome.trim(), position: unit?.position ?? curriculum.data!.length, hours: unit?.hours || 0 }
        await api(unit ? `/units/${unit.id}` : `/courses/${courseId}/units`, { method: unit ? 'PATCH' : 'POST', body: jsonBody(body) })
      } else if (unit) {
        const collection = editor.kind === 'topic' ? 'topics' : 'skills'
        const existing = editor.kind === 'topic' ? unit.topics.find((item) => item.id === editor.itemId) : unit.skills.find((item) => item.id === editor.itemId)
        const body = { title: title.trim(), position: existing?.position ?? (editor.kind === 'topic' ? unit.topics.length : unit.skills.length), ...(editor.kind === 'skill' ? { description: outcome.trim() } : {}) }
        await api(editor.itemId ? `/${collection}/${editor.itemId}` : `/units/${unit.id}/${collection}`, {
          method: editor.itemId ? 'PATCH' : 'POST', body: jsonBody(body),
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['curriculum', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
      setEditor(null)
      toast(editor.kind === 'unit' ? 'Unidad guardada.' : editor.kind === 'topic' ? `Tema ${editor.itemId ? 'actualizado' : 'agregado'}.` : `Habilidad ${editor.itemId ? 'actualizada' : 'agregada'}.`)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo guardar.', 'error')
    } finally { setBusy(false) }
  }

  async function remove(unit: CurriculumUnit) {
    if (!window.confirm(`¿Eliminar “${unit.title}” y su contenido?`)) return
    try {
      await api(`/units/${unit.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['curriculum', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
      toast('Unidad eliminada.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar.', 'error') }
  }

  async function removeEntry(kind: 'topic' | 'skill', item: { id: string; title: string }) {
    if (!window.confirm(`¿Eliminar “${item.title}”?`)) return
    try {
      await api(`/${kind === 'topic' ? 'topics' : 'skills'}/${item.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['curriculum', courseId] })
      toast(kind === 'topic' ? 'Tema eliminado.' : 'Habilidad eliminada.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar.', 'error') }
  }

  async function move(unit: CurriculumUnit, offset: number) {
    const items = curriculum.data || []
    const currentIndex = items.findIndex((item) => item.id === unit.id)
    const target = items[currentIndex + offset]
    if (!target) return
    try {
      await Promise.all([
        api(`/units/${unit.id}`, { method: 'PATCH', body: jsonBody({ title: unit.title, outcome: unit.outcome, position: target.position, hours: unit.hours }) }),
        api(`/units/${target.id}`, { method: 'PATCH', body: jsonBody({ title: target.title, outcome: target.outcome, position: unit.position, hours: target.hours }) }),
      ])
      await queryClient.invalidateQueries({ queryKey: ['curriculum', courseId] })
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo cambiar el orden.', 'error') }
  }

  function open(kind: EditState['kind'], unit?: CurriculumUnit, item?: { id: string; title: string; description?: string }) {
    setEditor({ kind, unit, itemId: item?.id })
    setTitle(item?.title || (kind === 'unit' ? unit?.title : '') || '')
    setOutcome(kind === 'unit' ? unit?.outcome || '' : item?.description || '')
  }

  if (curriculum.isLoading) return <LoadingState />
  if (curriculum.isError) return <ErrorState message="No pudimos cargar la estructura académica." retry={() => void curriculum.refetch()} />
  const units = curriculum.data!
  const editorTitle = editor?.kind === 'unit' ? (editor.unit ? 'Editar unidad' : 'Nueva unidad') : editor?.kind === 'topic' ? (editor.itemId ? 'Editar tema' : 'Agregar tema') : editor?.itemId ? 'Editar habilidad' : 'Agregar habilidad'

  return <>
    <PageHeader title="Estructura académica" description="Organiza el curso en unidades, temas y habilidades que orienten las actividades." actions={<Button onClick={() => open('unit')}><Plus size={16} />Nueva unidad</Button>} />
    <Card className="mb"><div className="card-heading"><h2>Generar temas y habilidades</h2><p className="muted-text text-small">La IA usa exclusivamente la descripción del curso y los materiales procesados. El contenido generado queda en borrador con sus fuentes para revisión.</p></div><div className="card-content settings-form"><div className="form-grid"><Field label="Temas por unidad"><TextInput type="number" min="1" max="20" value={generationCounts.topic_count} onChange={(event) => setGenerationCounts({ ...generationCounts, topic_count: Number(event.target.value) })} /></Field><Field label="Habilidades por unidad"><TextInput type="number" min="1" max="20" value={generationCounts.skill_count} onChange={(event) => setGenerationCounts({ ...generationCounts, skill_count: Number(event.target.value) })} /></Field></div></div></Card>
    {!units.length ? <Card><EmptyState icon={Layers3} title="La estructura aún está vacía" description="Empieza con unidades y agrega temas y habilidades a medida que preparas el curso." action={<Button onClick={() => open('unit')}><Plus size={15} />Crear primera unidad</Button>} /></Card> : <div className="curriculum-list">{units.map((unit, index) => <Card className="unit-card" key={unit.id}>
      <div className="unit-card-header"><span className="unit-number">{String(index + 1).padStart(2, '0')}</span><div className="unit-card-title"><h2>Unidad {index + 1} · {unit.title}</h2><p>{unit.outcome || 'Agrega un resultado de aprendizaje para esta unidad.'}</p></div><div className="unit-controls"><Button size="small" variant="outline" disabled={generateContent.isPending || generationCounts.topic_count < 1 || generationCounts.topic_count > 20 || generationCounts.skill_count < 1 || generationCounts.skill_count > 20} onClick={() => generateContent.mutate(unit.id)}><Sparkles size={14} />Generar contenido</Button><Button variant="ghost" size="small" aria-label="Subir unidad" disabled={index === 0} onClick={() => void move(unit, -1)}><ArrowUp size={15} /></Button><Button variant="ghost" size="small" aria-label="Bajar unidad" disabled={index === units.length - 1} onClick={() => void move(unit, 1)}><ArrowDown size={15} /></Button><Button variant="ghost" size="small" aria-label="Eliminar unidad" onClick={() => void remove(unit)}><Trash2 size={15} /></Button></div></div>
      <div className="unit-content-grid">
        <div><div className="unit-subheading"><span><BookOpen size={15} />Temas</span><Button variant="outline" size="small" onClick={() => open('topic', unit)}><Plus size={13} />Agregar</Button></div>{unit.topics.length ? <ul className="curriculum-items">{unit.topics.map((topic) => <li className="curriculum-item" key={topic.id}><span>{topic.title}<small><Badge tone={topic.status === 'published' ? 'success' : 'warning'}>{topic.status === 'published' ? 'Publicado' : 'Borrador'}</Badge></small>{!!topic.source_refs?.length && <details className="question-sources"><summary>Fuentes ({topic.source_refs.length})</summary><ul>{topic.source_refs.map((ref, i) => <li key={`${ref.material_id}-${ref.chunk_index}-${i}`}><strong>{ref.material_name}</strong>{ref.page_number != null ? ` · p. ${ref.page_number}` : ''}<p>{ref.excerpt}</p></li>)}</ul></details>}</span><span className="curriculum-item-actions">{topic.status === 'draft' && <button onClick={() => publishContent.mutate({ kind: 'topic', id: topic.id })} aria-label={`Aprobar tema ${topic.title}`}><Check size={13} /></button>}<button onClick={() => open('topic', unit, topic)} aria-label={`Editar tema ${topic.title}`}><BookOpen size={13} /></button><button onClick={() => void removeEntry('topic', topic)} aria-label={`Eliminar tema ${topic.title}`}><Trash2 size={13} /></button></span></li>)}</ul> : <p className="subsection-empty">Aún no hay temas definidos.</p>}</div>
        <div><div className="unit-subheading"><span><Target size={15} />Habilidades</span><Button variant="outline" size="small" onClick={() => open('skill', unit)}><Plus size={13} />Agregar</Button></div>{unit.skills.length ? <ul className="curriculum-items">{unit.skills.map((skill) => <li className="curriculum-item" key={skill.id}><span><strong>{skill.title}</strong>{skill.description && <small>{skill.description}</small>}<small><Badge tone={skill.status === 'published' ? 'success' : 'warning'}>{skill.status === 'published' ? 'Publicada' : 'Borrador'}</Badge></small>{!!skill.source_refs?.length && <details className="question-sources"><summary>Fuentes ({skill.source_refs.length})</summary><ul>{skill.source_refs.map((ref, i) => <li key={`${ref.material_id}-${ref.chunk_index}-${i}`}><strong>{ref.material_name}</strong>{ref.page_number != null ? ` · p. ${ref.page_number}` : ''}<p>{ref.excerpt}</p></li>)}</ul></details>}</span><span className="curriculum-item-actions">{skill.status === 'draft' && <button onClick={() => publishContent.mutate({ kind: 'skill', id: skill.id })} aria-label={`Aprobar habilidad ${skill.title}`}><Check size={13} /></button>}<button onClick={() => open('skill', unit, skill)} aria-label={`Editar habilidad ${skill.title}`}><Target size={13} /></button><button onClick={() => void removeEntry('skill', skill)} aria-label={`Eliminar habilidad ${skill.title}`}><Trash2 size={13} /></button></span></li>)}</ul> : <p className="subsection-empty">Aún no hay habilidades definidas.</p>}</div>
      </div>
    </Card>)}</div>}
    <Modal open={!!editor} onClose={() => setEditor(null)} title={editorTitle} description={editor?.kind !== 'unit' ? editor?.unit?.title : 'Puedes ajustar los detalles de la unidad después.'} onSubmit={save} submitLabel="Guardar" busy={busy}>
      <Field label={editor?.kind === 'unit' ? 'Nombre de la unidad' : editor?.kind === 'topic' ? 'Nombre del tema' : 'Nombre de la habilidad'} required><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value.toUpperCase())} required maxLength={240} placeholder="Escribe un nombre claro" /></Field>
      {(editor?.kind === 'unit' || editor?.kind === 'skill') && <Field label={editor.kind === 'unit' ? 'Resultado de aprendizaje' : 'Descripción'}><TextArea rows={3} value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={5000} placeholder="Qué podrá hacer el estudiante al finalizar…" /></Field>}
    </Modal>
  </>
}
