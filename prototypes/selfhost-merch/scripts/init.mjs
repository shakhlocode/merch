import { mkdir, writeFile, access, chmod } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('../.local/', import.meta.url))
await mkdir(dir, { recursive: true, mode: 0o700 })
try { await access(dir + 'demo.env'); console.log('Existing demo configuration retained. See README for a full reset.'); process.exit(0) } catch { /* fresh demo */ }
const secret = () => randomBytes(32).toString('hex')
const env = { DEMO_DB_PASSWORD: secret(), DEMO_MIGRATOR_PASSWORD: secret(), DEMO_RETENTION_PASSWORD: secret(), DEMO_DATA_KEY: secret(), DEMO_BACKUP_KEY: secret(), DEMO_DB_ADMIN_PASSWORD: secret(), DEMO_KC_ADMIN_PASSWORD: secret(), DEMO_CLIENT_SECRET: secret(), DEMO_GUEST_TOKEN: secret(), DEMO_SESSION_PEPPER: secret() }
const password = 'Demo-' + randomBytes(12).toString('base64url')
const people = [
  { id: '20000000-0000-4000-8000-000000000001', username: 'alice', firstName: 'Алина', lastName: 'Тестовая', email: 'alice@example.invalid', code: 'TEST-101', legal: 'Тестовое юрлицо E-com', department: 'Тестовый отдел' },
  { id: '20000000-0000-4000-8000-000000000002', username: 'boris', firstName: 'Борис', lastName: 'Тестовый', email: 'boris@example.invalid', code: 'TEST-102', legal: 'Тестовое юрлицо Fintech', department: 'Онбординг (тест)' },
  { id: '20000000-0000-4000-8000-000000000003', username: 'outsider', firstName: 'Нет', lastName: 'Доступа', email: 'outsider@example.invalid', code: 'TEST-103', legal: 'Тестовое юрлицо', department: 'Тест' },
  { id: '20000000-0000-4000-8000-000000000004', username: 'blocked', firstName: 'Заблокирован', lastName: 'Тестовый', email: 'blocked@example.invalid', code: 'TEST-104', legal: 'Тестовое юрлицо', department: 'Тест', enabled: false }
]
people.push({id:'20000000-0000-4000-8000-000000000005',username:'organizer',firstName:'Организатор',lastName:'Тестовый',email:'organizer@example.invalid',code:'OP-001',legal:'Тест',department:'Тест'})
people.push({id:'20000000-0000-4000-8000-000000000006',username:'fintech-admin',firstName:'Админ Fintech',lastName:'Тестовый',email:'fintech-admin@example.invalid',code:'OP-002',legal:'Тест',department:'Тест'})
const realm = {
  realm: 'merch-storage-demo', enabled: true, sslRequired: 'none', registrationAllowed: false,
  resetPasswordAllowed: false, bruteForceProtected: true, loginWithEmailAllowed: true,
  accessTokenLifespan: 300, ssoSessionIdleTimeout: 1800,
  clients: [{ clientId: 'merch-storage-review', name: 'Isolated Merch Review', protocol: 'openid-connect', publicClient: false, secret: env.DEMO_CLIENT_SECRET,
    standardFlowEnabled: true, directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
    redirectUris: ['http://127.0.0.1:3280/auth/callback'], webOrigins: [],
    defaultClientScopes: ['profile', 'email'], optionalClientScopes: [],
    attributes: { 'pkce.code.challenge.method': 'S256', 'backchannel.logout.url': 'http://app:3280/auth/backchannel-logout', 'backchannel.logout.session.required': 'true' },
    protocolMappers: []
  }],
  users: people.map(p => ({ id: p.id, username: p.username, email: p.email, emailVerified: true, enabled: p.enabled !== false, firstName: p.firstName, lastName: p.lastName,
    attributes: { employee_id: [p.code], legal_entity: [p.legal], department: [p.department] },
    credentials: [{ type: 'password', value: password, temporary: false }] }))
}
await writeFile(dir + 'realm.json', JSON.stringify(realm, null, 2), { mode: 0o644 })
// Keycloak runs as a different container UID. The parent folder remains private.
await chmod(dir + 'realm.json', 0o644)
await writeFile(dir + 'demo.env', Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
await writeFile(dir + 'accounts.json', JSON.stringify({ password, users: people.map(({username,enabled}) => ({username, enabled: enabled !== false})), guestIdentifier: 'TEST-GUEST-001' }, null, 2), { mode: 0o600 })
console.log('Generated synthetic accounts and local secrets in ignored .local/. No corporate services configured. Credentials: .local/accounts.json (do not commit).')
