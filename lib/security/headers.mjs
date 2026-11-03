/** @param {string} nonce @param {string|undefined} supabaseUrl @param {boolean} development */
export function contentSecurityPolicy(nonce, supabaseUrl, development=false) {
  if(!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Invalid CSP nonce')
  let backend=''
  if(supabaseUrl){const u=new URL(supabaseUrl);if(!['https:','http:'].includes(u.protocol))throw new Error('Invalid backend URL');backend=` ${u.origin} ${u.origin.replace(/^http/,'ws')}`}
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'${backend}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
}
export function securityHeaders(production=false){
 return [
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'X-Frame-Options',value:'DENY'},
  {key:'Referrer-Policy',value:'no-referrer'},
  {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=()'},
  ...(production?[{key:'Strict-Transport-Security',value:'max-age=31536000'}]:[]),
 ]
}
