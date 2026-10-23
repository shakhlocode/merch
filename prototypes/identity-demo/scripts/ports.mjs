// Local-only development bridge: preserve a Docker network with zero egress.
// No Docker ports or routable frontend network are needed.
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd=fileURLToPath(new URL('../',import.meta.url))
const container=execFileSync('docker',['compose','--env-file','.local/demo.env','ps','--quiet','app'],{cwd,encoding:'utf8'}).trim()
if(!/^[a-f0-9]{12,64}$/.test(container))throw new Error('Start demo containers first')
const code=`const net=require('node:net');const s=net.connect({host:process.argv[1],port:Number(process.argv[2])});process.stdin.pipe(s);s.pipe(process.stdout);s.on('error',()=>process.exit(1));s.on('end',()=>process.exit(0));process.stdin.on('end',()=>s.end());`
const servers=[],children=new Set()
for(const [port,host,target]of [[3180,'127.0.0.1',3180],[8180,'keycloak',8080]]){
  const server=net.createServer(socket=>{
    const child=spawn('docker',['exec','-i',container,'node','-e',code,host,String(target)],{stdio:['pipe','pipe','ignore']})
    children.add(child);socket.pipe(child.stdin);child.stdout.pipe(socket)
    const close=()=>{children.delete(child);socket.destroy();child.kill()}
    child.on('error',close);child.on('exit',close);socket.on('error',close);socket.on('close',close);child.stdin.on('error',()=>{})
  })
  server.on('error',()=>{console.error('Cannot bind local demo port '+port);process.exit(1)})
  server.listen(port,'127.0.0.1',()=>console.log('Local-only demo bridge listening on port '+port))
  servers.push(server)
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const s of servers)s.close();for(const c of children)c.kill();process.exit(0)})
