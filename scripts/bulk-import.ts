/**
 * Bulk import: {folders:[{name,type,color}], journals:[{name,folder,pages}],
 *               scenes:[{name,img,grid,width,height,notes:[{journal, ...}]}],
 *               actors:[{name,type,system,items,biome}]}
 * Folders -> journals -> scenes (pins resolved by journal name) -> actors.
 * Usage: bun scripts/bulk-import.ts <payload.json> [--only=A,B] [--dry]
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

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bulk-import', version: '1.1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
await sleep(6000);

async function call(name: string, args: any): Promise<string> {
  const res = await rpc('tools/call', { name, arguments: args });
  return res?.result?.content?.map((c: any) => c.text).join('\n') ?? JSON.stringify(res);
}
const idsIn = (t: string) => [...t.matchAll(/IDs?:\*?\*?\s*([a-zA-Z0-9]{16})/g)].map((m) => m[1]);

if (dry) { console.log(`dry run: folders=${payload.folders?.length ?? 0} journals=${payload.journals?.length ?? 0} scenes=${payload.scenes?.length ?? 0} actors=${payload.actors?.length ?? 0}`); child.kill(); process.exit(0); }

// 1. folders
const folderIds = new Map<string, string>();
for (const f of payload.folders ?? []) {
  const text = await call('create_folder', { name: f.name, type: f.type ?? 'Actor', color: f.color });
  const id = idsIn(text)[0];
  if (id) folderIds.set(f.name, id); else console.log(`folder FAILED: ${f.name}\n${text}`);
  await sleep(250);
}
console.log(`folders: ${folderIds.size}/${payload.folders?.length ?? 0}`);

// 2. journals
const journalRefs = new Map<string, { journalId: string; pageId: string }>();
const journals = only ? (payload.journals ?? []).filter((j: any) => only.includes(j.name)) : payload.journals ?? [];
for (const j of journals) {
  const args: any = { name: j.name, pages: j.pages };
  if (j.folder && folderIds.has(j.folder)) args.folder = folderIds.get(j.folder);
  if (j.visibility) args.visibility = j.visibility;
  const text = await call('create_journal_entry', args);
  const ids = idsIn(text);
  if (ids.length >= 2) journalRefs.set(j.name, { journalId: ids[0], pageId: ids[1] });
  else console.log(`journal FAILED: ${j.name}\n${text}`);
  await sleep(200);
}
console.log(`journals: ${journalRefs.size}/${journals.length}`);

// 3. scenes (notes resolved from journalRefs)
for (const sc of payload.scenes ?? []) {
  const notes = (sc.notes ?? []).flatMap((n: any) => {
    if (n.journalId && (n.entryId || n.pageId)) {
      return [{ x: n.x, y: n.y, journalId: n.journalId, entryId: n.entryId ?? n.pageId, text: n.text ?? '', icon: n.icon ?? 'icons/svg/book.svg' }];
    }
    const ref = journalRefs.get(n.journal);
    if (!ref) { console.log(`  note unresolved: ${n.journal}`); return []; }
    return [{ x: n.x, y: n.y, journalId: ref.journalId, entryId: ref.pageId, text: n.text ?? n.journal, icon: n.icon ?? 'icons/svg/book.svg' }];
  });
  const args: any = { name: sc.name, notes };
  for (const k of ['img', 'width', 'height']) if (sc[k] !== undefined) args[k] = sc[k];
  if (sc.grid) args.grid = sc.grid;
  const text = await call('create_scene', args);
  console.log(`scene "${sc.name}": ${idsIn(text)[0] ?? 'FAILED'} (${notes.length} notes)`);
  await sleep(300);
}

// 4. actors
let ok = 0, fail = 0;
const actors = only ? (payload.actors ?? []).filter((a: any) => only.includes(a.name)) : payload.actors ?? [];
for (const a of actors) {
  const folderId = folderIds.get(`Bestiary — ${a.biome}`);
  const args: any = { name: a.name, type: a.type, system: a.system, items: a.items };
  if (folderId) args.folder = folderId;
  const text = await call('create_actor', args);
  if (text.includes('FAILED') || /error/i.test(text)) { fail++; console.log(`✗ ${a.name}`); }
  else if (++ok % 25 === 0) console.log(`… ${ok}/${actors.length}`);
  await sleep(250);
}
if (actors.length) console.log(`actors: ${ok} created, ${fail} failed`);
child.kill();
process.exit(0);
