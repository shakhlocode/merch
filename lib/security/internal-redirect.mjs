/** Only root-relative same-origin destinations. Shared by browser and server callbacks.
 * @param {unknown} value @param {string} origin @param {string} fallback */
export function internalRedirect(value, origin, fallback='/catalog') {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return fallback
  try{
    const base=new URL(origin),target=new URL(value,base)
    if(target.origin!==base.origin||target.username||target.password)return fallback
    // Reject encoded path separators/controls that a router/proxy might decode later.
    let path=value.split(/[?#]/,1)[0]
    for(let i=0;i<3;i++){
      if(/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path))return fallback
      const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded
    }
    return target.pathname+target.search+target.hash
  }catch{return fallback}
}
