export type ImportEmployee = { email: string; full_name: string; external_id: string | null }

export function parseEmployeeCsv(text: string): string[][] {
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ','
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i+1] === '"') { value += '"'; i++ } else quoted = !quoted }
    else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
      row.push(value); value = ''
      if (c !== delimiter) { rows.push(row); row = []; if (c === '\r' && text[i+1] === '\n') i++ }
    } else value += c
  }
  if (quoted) throw new Error('В CSV не закрыты кавычки')
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows
}

export function validateEmployeeRows(raw: unknown[][]): { rows: ImportEmployee[]; errors: string[] } {
  const header = (raw[0] ?? []).map(v => String(v ?? '').replace(/^\uFEFF/, '').trim().toLowerCase())
  const mail = header.findIndex(v => ['email','e-mail','почта','имейл'].includes(v))
  const name = header.findIndex(v => ['full_name','фио','ф.и.о.'].includes(v))
  const id = header.findIndex(v => ['external_id','идентификатор','id'].includes(v))
  if (mail < 0 || name < 0) return { rows: [], errors: ['В первой строке нужны заголовки Email и ФИО. Идентификатор — необязательно.'] }
  const rows: ImportEmployee[] = [], errors: string[] = [], emails = new Set<string>(), ids = new Set<string>()
  raw.slice(1).forEach((row, index) => {
    if (row.every(v => v === null || v === undefined || String(v).trim() === '')) return
    const email = String(row[mail] ?? '').trim().toLowerCase(), full_name = String(row[name] ?? '').trim(), external_id = id < 0 ? null : String(row[id] ?? '').trim() || null
    const prefix = `Строка ${index + 2}: `
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(prefix+'некорректный email')
    if (!full_name) errors.push(prefix+'не указано ФИО')
    if (emails.has(email)) errors.push(prefix+'email повторяется в файле')
    if (external_id && ids.has(external_id)) errors.push(prefix+'идентификатор повторяется в файле')
    emails.add(email); if (external_id) ids.add(external_id)
    rows.push({ email, full_name, external_id })
  })
  if (!rows.length || rows.length > 2000) errors.push('В файле должно быть от 1 до 2000 сотрудников')
  return { rows, errors }
}
