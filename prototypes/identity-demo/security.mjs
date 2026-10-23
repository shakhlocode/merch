import { createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
export const random = () => randomBytes(32).toString('base64url')
export const hash = value => createHash('sha256').update(value).digest('hex')
export const pkce = value => createHash('sha256').update(value).digest('base64url')
export const sessionHash = (value, pepper) => createHmac('sha256', pepper).update(value).digest('hex')
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
export function assertDemoConfig(env) {
  if (env.DEMO_ONLY !== 'true') throw new Error('Only isolated demo mode is supported')
  const base = new URL(env.DEMO_BASE_URL), issuer = new URL(env.DEMO_ISSUER)
  if (base.origin !== 'http://127.0.0.1:3180' || issuer.href !== 'http://127.0.0.1:8180/realms/merch-demo') throw new Error('Non-demo origin refused')
  if (env.DEMO_IDP_INTERNAL_ORIGIN !== 'http://keycloak:8080') throw new Error('Non-demo provider refused')
  if (env.DEMO_CLIENT_ID !== 'merch-review') throw new Error('Non-demo client refused')
  for (const key of ['DEMO_CLIENT_SECRET','DEMO_DB_PASSWORD','DEMO_GUEST_TOKEN','DEMO_SESSION_PEPPER']) if (!/^[a-f0-9]{64}$/.test(env[key] || '')) throw new Error('Run demo initialization: ' + key)
  return { base: base.origin, issuer: issuer.href }
}
export function corporateClaims(payload, nonce, clientId) {
  if (!equal(payload.nonce, nonce) || typeof payload.sub !== 'string' || !payload.sub || payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email.includes('@')) throw new Error('Invalid corporate identity')
  if ((Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) || (payload.azp && payload.azp !== clientId)) throw new Error('Wrong authorized party')
  for (const k of ['name','employee_id','legal_entity','department']) if (typeof payload[k] !== 'string' || !payload[k].trim() || payload[k].length > 250) throw new Error('Missing trusted attribute: ' + k)
  return { subject: payload.sub, email: payload.email, name: payload.name, code: payload.employee_id, legal: payload.legal_entity, department: payload.department, sid: typeof payload.sid === 'string' ? payload.sid : null }
}
export function validateOrder(body, scope, method) {
  const keys = ['items','mode','phone','office','country','city','address','pvz','comment','csrf']
  if (Object.keys(body).some(k => !keys.includes(k))) throw new Error('Кадровые данные и права нельзя передавать или изменять в заказе')
  const products = scope === 'welcome' ? ['welcome-shirt','welcome-notebook'] : ['shirt','notebook','bag']
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 3 || new Set(body.items.map(x => x.id)).size !== body.items.length) throw new Error('Выберите от 1 до 3 разных товаров')
  for (const item of body.items) if (!products.includes(item.id) || !['S','M','L','Стандартный'].includes(item.size) || !['Фиолетовый','Как на фото'].includes(item.color) || item.qty !== 1) throw new Error('Товар, размер или количество недоступны')
  if (!['office','shipping','pvz'].includes(body.mode) || (scope === 'welcome' && body.mode !== 'office') || (body.mode === 'pvz' && method !== 'identifier')) throw new Error('Способ получения недоступен')
  if (typeof body.phone !== 'string' || !/^[+()\d\s-]{7,30}$/.test(body.phone) || body.phone.replace(/\D/g,'').length < 7) throw new Error('Укажите телефон')
  const field = key => typeof body[key] === 'string' && body[key].trim().length > 0 && body[key].length <= 300
  if (body.mode === 'office' && !['Офис 1 (тест)','Офис 2 (тест)'].includes(body.office)) throw new Error('Выберите офис')
  if (body.mode === 'shipping' && !['country','city','address'].every(field)) throw new Error('Укажите страну, город и адрес доставки')
  if (body.mode === 'pvz' && !field('pvz')) throw new Error('Укажите ПВЗ')
  if (typeof body.comment !== 'string' || body.comment.length > 1000) throw new Error('Комментарий слишком длинный')
  return {
    items: body.items.map(({id,size,color}) => ({id,size,color,qty:1})), mode: body.mode, phone: body.phone.trim(),
    ...(body.mode === 'office' ? {office:body.office} : body.mode === 'pvz' ? {pvz:body.pvz.trim()} : {country:body.country.trim(),city:body.city.trim(),address:body.address.trim()}),
    ...(body.mode !== 'office' ? {comment:body.comment} : {})
  }
}
