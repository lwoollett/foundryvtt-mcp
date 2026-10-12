/**
 * Bulk import: reads a payload JSON {folders:[{name,type,color}], actors:[{...}]}
 * and creates them via the running MCP server over stdio.
 * Usage: bun scripts/bulk-import.ts /tmp/bestiary-payload.json [--only Name1,Name2] [--dry]
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SERVER = new URL('../dist/index.js', import.meta.url).pathname;
const file = process.argv[2];
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;
const dry = process.argv.includes('--dry');
const payload = JSON.parse(readFileSync(file, 'utf8'));

const child = spawn('bun', [SERVER], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map<number, (v: any) => void>();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
    } catch { /* partial */ }
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[srv] ${d}`));

let nextId = 1;
function rpc(method: string, params?: any): Promise<any> {
  const id = nextId++;
  const p = new Promise((res) => pending.set(id, res));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return p as Promise<any>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bulk-import', version: '1.0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
await sleep(6000); // auth + world load

async function call(name: string, args: any): Promise<string> {
  const res = await rpc('tools/call', { name, arguments: args });
  return res?.result?.content?.map((c: any) => c.text).join('\n') ?? JSON.stringify(res);
}

const folderIds = new Map<string, string>();
for (const f of payload.folders) {
  const text = await call('create_folder', { name: f.name, type: f.type ?? 'Actor', color: f.color });
  const m = text.match(/ID:\*?\*?\s*([a-zA-Z0-9]{16})/);
  if (m) folderIds.set(f.name, m[1]);
  console.log(`folder "${f.name}" -> ${m ? m[1] : 'FAILED'}`);
  if (!m) console.log(text);
  await sleep(300);
}

const actors = only ? payload.actors.filter((a: any) => only.includes(a.name)) : payload.actors;
if (dry) {
  console.log(`dry run: would create ${actors.length} actors`);
  child.kill(); process.exit(0);
}

let ok = 0, fail = 0;
for (const a of actors) {
  const folderId = folderIds.get(`Bestiary — ${a.biome}`);
  const args: any = { name: a.name, type: a.type, system: a.system, items: a.items };
  if (folderId) args.folder = folderId;
  try {
    const text = await call('create_actor', args);
    if (text.includes('FAILED') || text.toLowerCase().includes('error')) {
      fail++; console.log(`✗ ${a.name}: ${text.slice(0, 200)}`);
    } else { ok++; if (ok % 25 === 0) console.log(`… ${ok}/${actors.length}`); }
  } catch (e: any) {
    fail++; console.log(`✗ ${a.name}: ${e.message}`);
  }
  await sleep(250);
}
console.log(`done: ${ok} created, ${fail} failed`);
child.kill();
process.exit(fail > 0 ? 1 : 0);
