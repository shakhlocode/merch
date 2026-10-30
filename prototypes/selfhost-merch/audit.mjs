import { randomUUID } from 'node:crypto'

// Closed vocabulary: never log URLs, query strings, headers, payloads or exceptions.
export function auditCategory(path) {
  if (path.startsWith('/api/admin/')) return 'administration'
  if (path === '/api/lifecycle/events') return 'lifecycle'
  if (path.startsWith('/auth/')) return 'corporate_auth'
  if (path.startsWith('/api/email/') || path === '/email-login') return 'email_auth'
  if (path === '/api/guest') return 'identifier_auth'
  if (path === '/logout') return 'logout'
  if (path.startsWith('/api/')) return 'application_api'
  return null
}
export function attachAudit(req, res, path, write = line => process.stdout.write(line)) {
  const category = auditCategory(path)
  const requestId = randomUUID()
  res.setHeader('X-Request-ID', requestId)
  if (!category) return
  const start = performance.now()
  let actor = null, finished = false
  const emit = aborted => {
    if (finished) return
    finished = true
    const status = aborted ? 499 : res.statusCode
    write(JSON.stringify({version:1,event:'security_request',time:new Date().toISOString(),request_id:requestId,
      category,method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(req.method)?req.method:'OTHER',
      status,outcome:aborted?'aborted':status>=400?'rejected':'completed',actor_id:actor,
      duration_ms:Math.max(0,Math.round(performance.now()-start))})+'\n')
  }
  res.once('finish',()=>emit(false))
  res.once('close',()=>emit(!res.writableFinished))
  return id => { if (typeof id==='string' && /^[a-f0-9-]{36}$/i.test(id)) actor=id }
}
