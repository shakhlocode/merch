import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputs = [
  'supabase/base.sql',
  'auth-setup.sql',
  'employee-merch-rules-and-waybill.sql',
  'merch-handout-features.sql',
  'employee-directory-audit.sql',
  'merch-remote-order.sql',
  'supabase/runtime.sql',
]
const chunks = await Promise.all(inputs.map(async file =>
  `-- Source: ${file}\n${await readFile(path.join(root, file), 'utf8')}`))
await mkdir(path.join(root, 'supabase/migrations'), { recursive: true })
await writeFile(path.join(root, 'supabase/migrations/20261013000000_merch.sql'),
  '-- Reconstructed fresh-project setup. Do not run against the old database.\nBEGIN;\n\n' + chunks.join('\n\n') + '\n\nCOMMIT;\n')
console.log('Built supabase/migrations/20261013000000_merch.sql')
