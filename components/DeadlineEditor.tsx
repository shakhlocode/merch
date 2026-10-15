'use client'

import { unitFetch } from '@/lib/shop-context'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type DeadlineEditorProps = {
  handoutDeadline: string | null
  handoutPlace: string | null
  handoutNote: string | null
}

/** Turns an ISO timestamp into a value for <input type="datetime-local">. */
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function DeadlineEditor({
  handoutDeadline,
  handoutPlace,
  handoutNote,
}: DeadlineEditorProps) {
  const router = useRouter()

  const [deadline, setDeadline] = useState(toLocalInput(handoutDeadline))
  const [place,    setPlace]    = useState(handoutPlace ?? '')
  const [note,     setNote]     = useState(handoutNote ?? '')

  const [isSaving, setIsSaving] = useState(false)
  const [message,  setMessage]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  async function handleSave() {
    setIsSaving(true)
    setMessage(null)
    setError(null)

    try {
      const response = await unitFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handout_deadline: deadline ? new Date(deadline).toISOString() : null,
          handout_place: place,
          handout_note: note,
        }),
      })

      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось сохранить'); return }

      setMessage('Сохранено')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="deadline-editor">
      <label className="deadline-field">
        Дата и время раздачи
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="deadline-input"
        />
      </label>

      <label className="deadline-field">
        Место раздачи
        <input
          type="text"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Например: офис Ташкент, 3 этаж"
          className="deadline-input"
        />
      </label>

      <label className="deadline-field">
        Примечание (необязательно)
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Например: возьмите пропуск"
          className="deadline-input"
        />
      </label>

      {error   && <div className="deadline-error">{error}</div>}
      {message && <div className="deadline-success">{message}</div>}

      <button type="button" onClick={handleSave} disabled={isSaving} className="deadline-save">
        {isSaving ? 'Сохраняем...' : 'Сохранить дедлайн раздачи'}
      </button>
    </div>
  )
}
