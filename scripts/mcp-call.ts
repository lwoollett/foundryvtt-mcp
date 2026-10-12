/**
 * Drive the foundryvtt-mcp server over stdio JSON-RPC from a script.
 * Usage: bun scripts/mcp-call.ts '<json-args>' <toolName>
 * Env: FOUNDRY_URL, FOUNDRY_USERNAME, FOUNDRY_PASSWORD, FOUNDRY_WRITE_ENABLED
 */
import { spawn } from 'node:child_process';

const SERVER = new URL('../dist/index.js', import.meta.url).pathname;
const [toolName, argsJson] = process.argv.slice(2);

const child = spawn('bun', [SERVER], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const pending = new Map<number, (v: any) => void>();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx: number;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    } catch { /* partial line */ }
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

function rpc(method: string, params?: any): Promise<any> {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const p = new Promise((res) => pending.set(id, res));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return p as Promise<any>;
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'bulk-import', version: '1.0' },
});
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
// give the server time to authenticate + load world data
await new Promise((r) => setTimeout(r, 6000));

const res = await rpc('tools/call', {
  name: toolName,
  arguments: argsJson ? JSON.parse(argsJson) : {},
});

const text = res?.result?.content?.map((c: any) => c.text).join('\n')
  ?? JSON.stringify(res);
console.log(text);
if (res?.isError) process.exitCode = 1;
child.kill();
process.exit(process.exitCode ?? 0);
