'use client'

import { unitFetch } from '@/lib/shop-context'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from '@/components/ShopLink'
import { useRouter } from 'next/navigation'
import type { IScannerControls } from '@zxing/browser'

type Pickup = {
  order_id: string; order_number: string; version: number; status: string; can_issue: boolean
  recipient: string | null; storage_location: string | null; already_issued: boolean
  received_at: string | null; issued_by_name: string | null
  items: { name: string; size: string | null; color: string | null; qty: number }[]
}
type Receipt = { order_number: string; already_issued: boolean; received_at: string | null; issued_by_name: string | null; recipient: string | null }
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : 'Не указано'

export default function IssueClient() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [autoLookup, setAutoLookup] = useState(true)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickup, setPickup] = useState<Pickup | null>(null)
  const [scannedCode, setScannedCode] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const busyRef = useRef(false)
  const pendingScan = useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const overlay = camera || !!pickup

  function cancelPendingScan() {
    if (pendingScan.current !== null) clearTimeout(pendingScan.current)
    pendingScan.current = null
  }
  useEffect(() => () => { if (pendingScan.current !== null) clearTimeout(pendingScan.current) }, [])
  useEffect(() => {
    if (!overlay) return
    const previous = document.body.style.overflow
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) { setCamera(false); setPickup(null) }
      if (e.key === 'Tab') {
        const nodes = [...document.querySelectorAll<HTMLElement>('.issue-overlay button:not(:disabled), .issue-overlay a[href]')]
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); previousFocus?.focus() }
  }, [overlay, camera])
  useEffect(() => {
    if (!busy && !overlay && window.matchMedia('(pointer: fine)').matches) { input.current?.focus(); input.current?.select() }
  }, [busy, overlay])

  const lookup = useCallback(async (value: string) => {
    cancelPendingScan()
    if (!/^\d{20}$/.test(value.trim()) || busyRef.current) return
    busyRef.current = true
    setBusy(true); setCamera(false); setError(null); setPickup(null); setReceipt(null)
    try {
      const response = await unitFetch('/api/admin/issue/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: value.trim() }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось найти заказ')
      setScannedCode(value.trim()); setPickup(result.order); setCode('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка поиска') }
    finally { busyRef.current = false; setBusy(false) }
  }, [])

  async function confirmIssue() {
    if (!pickup?.can_issue || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null)
    try {
      const response = await unitFetch('/api/admin/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: scannedCode, order_id: pickup.order_id, version: pickup.version, confirmed: true }) })
      const result = await response.json()
      if (!response.ok) {
        // Do not leave an enabled stale confirmation after another administrator changed the order.
        setPickup(null)
        throw new Error(result.error || 'Не удалось подтвердить выдачу. Отсканируйте код ещё раз.')
      }
      setReceipt(result.receipt); setPickup(null); setScannedCode(''); router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка выдачи') }
    finally { busyRef.current = false; setBusy(false) }
  }
  function changeCode(value: string) {
    cancelPendingScan(); setCode(value)
    if (autoLookup && !overlay && !busyRef.current && /^\d{20}$/.test(value.trim())) pendingScan.current = setTimeout(() => void lookup(value), 250)
  }
  useEffect(() => {
    if (!camera) return
    let disposed = false
    let controls: IScannerControls | undefined
    const element = video.current
    async function start() {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
        if (disposed || !element) return
        const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]))
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, element,
          result => { if (result && /^\d{20}$/.test(result.getText()) && !disposed) { disposed = true; controls?.stop(); void lookup(result.getText()) } })
        if (disposed) controls.stop()
      } catch {
        if (!disposed) { setError('Камера недоступна. Разрешите доступ к камере или используйте сканер / ручной ввод.'); setCamera(false) }
      }
    }
    void start()
    return () => {
      disposed = true; controls?.stop()
      if (typeof MediaStream !== 'undefined' && element?.srcObject instanceof MediaStream) element.srcObject.getTracks().forEach(track => track.stop())
    }
  }, [camera, lookup])

  function submit(event: FormEvent) { event.preventDefault(); void lookup(code) }
  function close() { if (!busyRef.current) { setCamera(false); setPickup(null); setScannedCode('') } }
  return <section className="issue-panel">
    <h2>Найти и выдать заказ</h2>
    <p>Отсканируйте QR, проверьте получателя и место хранения. Заказ отмечается «Получен» только после нажатия «Выдать заказ».</p>
    <p>Для USB- или Bluetooth-сканера нужна поддержка QR-кодов (2D). Сканирование и ручной ввод только открывают карточку заказа.</p>
    <button type="button" className="ao-save-btn" disabled={busy} onClick={() => { cancelPendingScan(); setCode(''); setError(null); setReceipt(null); setCamera(true) }}>Сканировать через камеру</button>
    <label><input type="checkbox" checked={autoLookup} disabled={busy || overlay} onChange={e => { cancelPendingScan(); setAutoLookup(e.target.checked) }} />{' '}Автоматически искать после ввода 20 цифр</label>
    <form onSubmit={submit} className="issue-form">
      <label>Код получения — 20 цифр
        <input ref={input} inputMode="numeric" type="text" autoComplete="off" spellCheck={false} value={code} onChange={e => changeCode(e.target.value)} disabled={busy || overlay} className="ao-input" />
      </label>
      <button className="ao-save-btn" disabled={busy || !/^\d{20}$/.test(code.trim())}>{busy ? 'Проверяем…' : 'Найти заказ'}</button>
    </form>
    {overlay && <div className={`issue-overlay${camera ? ' issue-camera-overlay' : ''}`} role="dialog" aria-modal="true" aria-labelledby="issue-dialog-title">
      <div className="issue-overlay-head"><h2 id="issue-dialog-title">{camera ? 'Сканирование QR' : `Заказ #${pickup?.order_number}`}</h2><button ref={closeButton} type="button" className="ao-light-btn" disabled={busy} onClick={close} aria-label="Закрыть">Закрыть</button></div>
      {camera && <><video ref={video} muted playsInline className="issue-camera-video" /><p className="issue-camera-hint">Наведите камеру на QR сотрудника. Сканирование не подтверждает выдачу.</p></>}
      {pickup && <div className="issue-pickup-body">
        <p className="issue-recipient"><span>Получатель</span><strong>{pickup.recipient || 'Имя не указано'}</strong></p>
        <div className="issue-location"><span>Где лежит заказ</span><strong>{pickup.storage_location?.trim() || 'Место хранения не указано — уточните у сборщика'}</strong></div>
        <h3>Состав заказа</h3><ul>{pickup.items.map((item, i) => <li key={i}>{item.name} · {item.size || 'Стандартный'} · {item.color || 'Как на фото'} · {item.qty} шт.</li>)}</ul>
        {pickup.already_issued ? <div role="status"><h3>Уже выдан</h3><p>{date(pickup.received_at)} · {pickup.issued_by_name || 'Администратор не указан'}</p><p>Повторного списания не будет.</p></div> : pickup.can_issue ? <><p>Найдите пакет и сверьте номер. Подтвердите выдачу при передаче сотруднику.</p><button type="button" className="ao-save-btn issue-confirm-btn" disabled={busy} onClick={() => void confirmIssue()}>{busy ? 'Подтверждаем…' : 'Выдать заказ'}</button></> : <p role="status">Выдача недоступна: заказ ещё не подготовлен либо отменён. Статус не изменён.</p>}
        <Link href={`/admin/orders?q=${encodeURIComponent(pickup.order_number)}`}>Открыть заказ</Link>
      </div>}
    </div>}
    {error && <div role="alert" className="ao-error">{error}</div>}
    {receipt && <div role="status" className="issue-receipt"><h3>{receipt.already_issued ? 'Уже выдан' : 'Заказ выдали'}</h3><p><b>#{receipt.order_number}</b> · {receipt.recipient}</p><p>Статус: <b>Получен</b></p><p>Когда: {date(receipt.received_at)}</p><p>Кто выдал: {receipt.issued_by_name || 'Администратор не указан'}</p><button className="ao-light-btn" onClick={() => { setReceipt(null); setCamera(true) }}>Сканировать следующий QR</button></div>}
  </section>
}
