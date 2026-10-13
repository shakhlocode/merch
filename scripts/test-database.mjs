import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = `merch-db-test-${process.pid}`
function run(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message)
  return result
}
try {
  // No published ports, no external connections, disposable database.
  run(['run', '--detach', '--name', name, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-bookworm'])
  let ready = false
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error('PostgreSQL did not become ready')
  for (const file of ['supabase/tests/platform-fixture.sql', 'supabase/migrations/20261013000000_merch.sql', 'supabase/tests/workflow.sql']) {
    const result = run(['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], await readFile(path.join(root, file), 'utf8'))
    const lines = result.stderr.split('\n').filter(line => /PASS:/.test(line))
    console.log(file + ': passed')
    for (const line of lines) console.log(line)
  }
  run(['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], `
    insert into public.employee_directory(email,full_name,hired_at)
      values('race@example.test','Concurrent buyer',current_date-interval '1 year');
    insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000005','race@example.test');
    insert into public.products(id,name) values('10000000-0000-0000-0000-000000000005','Last item');
    insert into public.product_variants(id,product_id,sku)
      values('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','LAST-ITEM');
    insert into public.stock_movements(variant_id,movement_type,qty)
      values('20000000-0000-0000-0000-000000000005','income',1);
  `)
  const checkout = `begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
    select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000005","qty":1}]','office',null,null,null,false,null);
    select pg_sleep(0.5); commit;`
  function buyer() {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'])
      let stderr = ''
      child.stdout.resume()
      child.stderr.on('data', data => { stderr += data })
      child.on('error', reject)
      child.on('close', status => resolve({ status, stderr }))
      child.stdin.end(checkout)
    })
  }
  const buyers = await Promise.all([buyer(), buyer()])
  if (buyers.filter(result => result.status === 0).length !== 1 ||
      !buyers.some(result => result.status !== 0 && result.stderr.includes('product_is_not_available'))) {
    throw new Error('Concurrent checkout must allow exactly one buyer: ' + JSON.stringify(buyers))
  }
  const stock = run(['exec', '-i', name, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
    "select (select count(*) from public.orders)=1 and total_qty=1 and reserved_qty=1 from public.product_variants where sku='LAST-ITEM';")
  if (stock.stdout.trim() !== 't') throw new Error('Concurrent checkout corrupted stock or orders')
  console.log('PASS: simultaneous buyers cannot reserve the same last item')
} finally {
  spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore' })
}
