'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { IScannerControls } from '@zxing/browser'

type Receipt = { order_id: string; order_number: string; already_issued: boolean; received_at: string; issued_by_name: string | null; recipient: string | null }

export default function IssueClient() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [autoIssue, setAutoIssue] = useState(true)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const busyRef = useRef(false)
  const pendingScan = useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  function cancelPendingScan() {
    if (pendingScan.current !== null) clearTimeout(pendingScan.current)
    pendingScan.current = null
  }

  useEffect(() => () => {
    if (pendingScan.current !== null) clearTimeout(pendingScan.current)
  }, [])

  // Refocus after React has enabled the input, ready for the next scan.
  useEffect(() => {
    if (!busy && !camera) {
      input.current?.focus()
      input.current?.select()
    }
  }, [busy, camera])

  const issue = useCallback(async (value: string) => {
    cancelPendingScan()
    if (!/^\d{20}$/.test(value.trim())) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setCamera(false); setError(null); setReceipt(null)
    try {
      const response = await fetch('/api/admin/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: value.trim() }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось подтвердить выдачу')
      setReceipt(result.receipt)
      setCode('')
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка выдачи') }
    finally { busyRef.current = false; setBusy(false) }
  }, [router])

  function changeCode(value: string) {
    cancelPendingScan()
    setCode(value)
    // Wait for input to settle: accept the complete code, never truncate it.
    // Enter submits immediately; Tab or no suffix works through this timer.
    if (autoIssue && !camera && !busyRef.current && /^\d{20}$/.test(value.trim())) {
      pendingScan.current = setTimeout(() => void issue(value), 250)
    }
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
  }, [camera, issue])

  function submit(event: FormEvent) { event.preventDefault(); void issue(code) }
  return <section className="issue-panel">
    <h2>Сканировать и выдать заказ целиком</h2>
    <p>После сканирования заказ со статусом «Можно забирать» сразу отмечается «Получен». Повторный скан покажет дату и администратора первой выдачи.</p>
    <p>Откройте эту страницу и сканируйте штрихкод в поле ниже. Подойдут USB- и Bluetooth-сканеры, которые вводят код как клавиатура. Отправлять Enter необязательно.</p>
    <label>
      <input type="checkbox" checked={autoIssue} disabled={busy || camera} onChange={e => {
        cancelPendingScan()
        setAutoIssue(e.target.checked)
      }} />{' '}
      Автоматически выдавать после ввода 20 цифр
    </label>
    {!autoIssue && <p>Ручной режим: введите код и нажмите «Выдать по коду» или Enter.</p>}
    <form onSubmit={submit} className="issue-form">
      <label>Код получения — 20 цифр
        <input ref={input} autoFocus inputMode="numeric" type="text" autoComplete="off" spellCheck={false} value={code} onChange={e => changeCode(e.target.value)} disabled={busy || camera} className="ao-input" />
      </label>
      <button className="ao-save-btn" disabled={busy || !/^\d{20}$/.test(code.trim())}>{busy ? 'Проверяем…' : 'Выдать по коду'}</button>
    </form>
    <button type="button" className="ao-light-btn" disabled={busy} onClick={() => { cancelPendingScan(); setCode(''); setError(null); setCamera(!camera) }}>
      {camera ? 'Остановить камеру' : 'Сканировать камерой телефона'}
    </button>
    <video ref={video} muted playsInline hidden={!camera} className="issue-video" />
    {error && <div role="alert" className="ao-error">{error}</div>}
    {receipt && <div role="status" className="issue-receipt">
      <h3>{receipt.already_issued ? 'Уже выдан' : 'Заказ выдали'}</h3>
      <p>Статус заказа: <b>Получен</b></p>
      <p><b>#{receipt.order_number}</b> · {receipt.recipient}</p>
      <p>Когда: {receipt.received_at ? new Date(receipt.received_at).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : 'Не указано'}</p>
      <p>Кто выдал: {receipt.issued_by_name || 'Не указан в старой записи'}</p>
      <Link href={`/admin/orders?q=${encodeURIComponent(receipt.order_number)}`}>Открыть заказ</Link>
    </div>}
  </section>
}
