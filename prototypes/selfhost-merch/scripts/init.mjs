import { mkdir, writeFile, access, chmod, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {portalPeople} from '../portal-directory.mjs'
const dir = fileURLToPath(new URL('../.local/', import.meta.url))
await mkdir(dir, { recursive: true, mode: 0o700 })
let existing=false
try { await access(dir + 'demo.env'); existing=true } catch { /* fresh demo */ }
if(existing&&!process.argv.includes('--refresh-mock-realm')){console.log('Existing demo configuration retained. See README for a full reset.');process.exit(0)}
const secret = () => randomBytes(32).toString('hex')
const env = existing?Object.fromEntries((await readFile(dir+'demo.env','utf8')).trim().split('\n').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]})):{ DEMO_DB_PASSWORD: secret(), DEMO_MIGRATOR_PASSWORD: secret(), DEMO_RETENTION_PASSWORD: secret(), DEMO_DATA_KEY: secret(), DEMO_BACKUP_KEY: secret(), DEMO_DB_ADMIN_PASSWORD: secret(), DEMO_KC_ADMIN_PASSWORD: secret(), DEMO_CLIENT_SECRET: secret(), DEMO_GUEST_TOKEN: secret(), DEMO_SESSION_PEPPER: secret() }
const password = existing?JSON.parse(await readFile(dir+'accounts.json','utf8')).password:'Demo-' + randomBytes(12).toString('base64url')
const people = portalPeople
const realm = {
  realm: 'merch-storage-demo', enabled: true, sslRequired: 'none', registrationAllowed: false,
  resetPasswordAllowed: false, bruteForceProtected: true, loginWithEmailAllowed: true,
  accessTokenLifespan: 300, ssoSessionIdleTimeout: 1800,
  clients: [{ clientId: 'merch-storage-review', name: 'Isolated Merch Review', protocol: 'openid-connect', publicClient: false, secret: env.DEMO_CLIENT_SECRET,
    standardFlowEnabled: true, directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
    redirectUris: ['http://127.0.0.1:3280/auth/callback'], webOrigins: [],
    defaultClientScopes: ['profile', 'email'], optionalClientScopes: [],
    attributes: { 'pkce.code.challenge.method': 'S256', 'backchannel.logout.url': 'http://app:3280/auth/backchannel-logout', 'backchannel.logout.session.required': 'true' },
    protocolMappers: [
      ['legal_entity_code','String',false],['merch_groups','String',true],['employee_active','boolean',false]
    ].map(([name,type,multi])=>({name,protocol:'openid-connect',protocolMapper:'oidc-usermodel-attribute-mapper',consentRequired:false,
      config:{'user.attribute':name,'claim.name':name,'jsonType.label':type,'multivalued':String(multi),'id.token.claim':'true','access.token.claim':'false','userinfo.token.claim':'false'}}))
  }],
  users: people.map(p => ({ id: p.subject, username: p.username, email: p.email, emailVerified: true, enabled: p.active, firstName: p.firstName, lastName: p.lastName,
    attributes: { legal_entity_code: [p.legalEntity], merch_groups: p.groups, employee_active: [String(p.active)] },
    credentials: [{ type: 'password', value: password, temporary: false }] }))
}
await writeFile(dir + 'realm.json', JSON.stringify(realm, null, 2), { mode: 0o644 })
// Keycloak runs as a different container UID. The parent folder remains private.
await chmod(dir + 'realm.json', 0o644)
await writeFile(dir + 'demo.env', Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
await writeFile(dir + 'accounts.json', JSON.stringify({ password, users: people.map(({username,active}) => ({username, enabled: active})), guestIdentifier: 'TEST-GUEST-001' }, null, 2), { mode: 0o600 })
console.log('Generated synthetic accounts and local secrets in ignored .local/. No corporate services configured. Credentials: .local/accounts.json (do not commit).')
