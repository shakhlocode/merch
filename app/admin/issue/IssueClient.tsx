'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import type { IScannerControls } from '@zxing/browser'

type Receipt = { order_id: string; order_number: string; already_issued: boolean; received_at: string; issued_by_name: string | null; recipient: string | null }

export default function IssueClient() {
  const [code, setCode] = useState('')
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const busyRef = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  async function issue(value: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setCamera(false); setError(null); setReceipt(null)
    try {
      const response = await fetch('/api/admin/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: value.trim() }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось подтвердить выдачу')
      setReceipt(result.receipt)
      setCode('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка выдачи') }
    finally { busyRef.current = false; setBusy(false); input.current?.focus() }
  }

  useEffect(() => {
    if (!camera) return
    let disposed = false
    let controls: IScannerControls | undefined
    async function start() {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
        if (disposed || !video.current) return
        const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]))
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current,
          result => { if (result && !disposed) { disposed = true; controls?.stop(); void issue(result.getText()) } })
        if (disposed) controls.stop()
      } catch {
        if (!disposed) { setError('Камера недоступна. Разрешите доступ к камере или используйте сканер / ручной ввод.'); setCamera(false) }
      }
    }
    void start()
    return () => { disposed = true; controls?.stop() }
  }, [camera])

  function submit(event: FormEvent) { event.preventDefault(); void issue(code) }
  return <section className="issue-panel">
    <h2>Сканировать и выдать заказ целиком</h2>
    <p>После сканирования готовый офисный заказ сразу отмечается «Выдали». Повторный скан покажет дату и администратора первой выдачи.</p>
    <form onSubmit={submit} className="issue-form">
      <label>Код получения — 20 цифр
        <input ref={input} autoFocus inputMode="numeric" type="text" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} disabled={busy} className="ao-input" />
      </label>
      <button className="ao-save-btn" disabled={busy || !/^\d{20}$/.test(code.trim())}>{busy ? 'Проверяем…' : 'Выдать по коду'}</button>
    </form>
    <button type="button" className="ao-light-btn" disabled={busy} onClick={() => { setError(null); setCamera(!camera) }}>
      {camera ? 'Остановить камеру' : 'Сканировать камерой телефона'}
    </button>
    <video ref={video} muted playsInline hidden={!camera} className="issue-video" />
    {error && <div role="alert" className="ao-error">{error}</div>}
    {receipt && <div role="status" className="issue-receipt">
      <h3>{receipt.already_issued ? 'Уже выдан' : 'Заказ выдали'}</h3>
      <p><b>#{receipt.order_number}</b> · {receipt.recipient}</p>
      <p>Когда: {receipt.received_at ? new Date(receipt.received_at).toLocaleString('ru-RU') : 'Не указано'}</p>
      <p>Кто выдал: {receipt.issued_by_name || 'Не указан в старой записи'}</p>
      <Link href={`/admin/orders?q=${encodeURIComponent(receipt.order_number)}`}>Открыть заказ</Link>
    </div>}
  </section>
}
