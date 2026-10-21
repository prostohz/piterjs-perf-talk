import { afterEach, vi } from "vitest";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../pipeline/snapshots.fixture.js";

export const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

export async function project(
  targetCode: string,
  agentMode = "success",
  response: unknown = { hypothesis: "Reduce work" },
) {
  const f = await fixture();
  roots.push(f.root);
  const directory = join(f.root, "targets", "fixture");
  await mkdir(directory, { recursive: true });
  await rename(f.source, join(directory, "library"));
  await writeFile(join(f.root, "package.json"), '{"type":"module"}');
  await writeFile(
    join(directory, "source.json"),
    JSON.stringify({
      repository: "https://example.invalid/library",
      commit: f.commit,
    }),
  );
  await writeFile(join(directory, "target.ts"), targetCode);
  const bin = join(f.root, "bin");
  await mkdir(bin);
  const executable = join(bin, "codex");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) { console.log('fake-codex 1.0'); process.exit(0); }
import readline from 'node:readline';
const response = ${JSON.stringify(response)};
const mode = ${JSON.stringify(agentMode)};
const threadId = 'session-' + process.pid;
let tools = [];
let callId = 0;
const send = message => console.log(JSON.stringify(message));
function finish() {
  send({method: 'item/completed', params: {threadId, item: {type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(response)}}});
  send({method: 'turn/completed', params: {threadId, turn: {status: mode === 'failure' ? 'failed' : 'completed', error: mode === 'failure' ? {message: 'Fake failure'} : null}}});
}
function verify() {
  send({id: 'tool-' + ++callId, method: 'item/tool/call', params: {threadId, turnId: 'turn-1', callId: String(callId), tool: tools[0].name, arguments: {}}});
}
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(join(f.root, "rpc.jsonl"))}, line + '\\n');
  if (message.method === 'initialize') send({id: message.id, result: {}});
  if (message.method === 'thread/start') {
    tools = message.params.dynamicTools;
    send({id: message.id, result: {thread: {id: threadId}}});
  }
  if (message.method === 'turn/start') {
    send({id: message.id, result: {turn: {id: 'turn-1'}}});
    fs.writeFileSync('index.ts', 'export const value = 80;');
    if (tools.length && mode !== 'failure' && mode !== 'skip-verification') verify();
    else finish();
  }
  if (message.result && String(message.id).startsWith('tool-')) {
    if (!message.result.success && callId < 3) {
      fs.writeFileSync('index.ts', 'export const value = 70;');
      verify();
    } else finish();
  }
});
`,
  );
  await chmod(executable, 0o755);
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  return f.root;
}

export const normalTarget = `
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export default {
  scenarios: ['operation'],
  async prepare(path) {
    const value = Number((await readFile(join(path, 'index.ts'), 'utf8')).match(/\\d+/)[0]);
    await writeFile(join(path, 'generated.js'), 'generated');
    return {
      async test() {},
      async measure() { return { operationTimeMs: value }; },
      async close() {}
    };
  }
};
`;
