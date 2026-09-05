#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const jeffd = fileURLToPath(new URL('../target/debug/jeffd', import.meta.url));
const controller = new AbortController();
const { signal } = controller;
const timeout = setTimeout(() => controller.abort(new Error('demo exceeded 45 seconds')), 45_000);
timeout.unref();

for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(name, () => {
    process.exitCode = code;
    controller.abort(new Error(`demo interrupted by ${name}`));
  });
}

function writeTask(taskPath, title) {
  return writeFile(taskPath, JSON.stringify({
    schemaVersion: 1, id: 1, slug: '0001-one', title,
    status: 'pending', stage: 'capture', priority: 'p2', deps: [],
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    agents: {
      implementer_agent_id: null, reviewer_agent_id: null,
      reviewer2_agent_id: null, audit_agent_id: null,
    },
    tests: { authored_by_agent_id: null, green: false, evidence: [] },
    review: { verdict: null, reviewer_agent_id: null, evidence: [] },
    audit: { required: false, verdict: 'na', audit_agent_id: null, evidence: [] },
    commits: [], kickbacks: [], blockedReason: null, abandonReason: null,
  }), { mode: 0o600 });
}

function assertTitle(snapshot, title) {
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].id, 1);
  assert.equal(snapshot.tasks[0].title, title);
}

async function main() {
  assert.equal(process.argv.length, 3, 'usage: node scripts/demo.mjs /path/to/jeff/src/cli/cook.js');
  const cook = path.resolve(process.argv[2]);
  await access(cook);
  await access(jeffd).catch(() => {
    throw new Error('Build jeffd first: cargo build --workspace --locked');
  });

  const root = await mkdtemp(path.join(os.tmpdir(), 'jeff-demo-'));
  const home = path.join(root, 'home');
  const socketPath = path.join(home, '.jeff/jeffd.sock');
  const project = path.join(root, 'project');
  const taskPath = path.join(project, '.jeff/tasks/0001-one/task.json');
  const env = {
    HOME: home, JEFFD_SOCK: socketPath, TMPDIR: root,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const options = { env, cwd: project, signal, timeout: 10_000, killSignal: 'SIGKILL' };
  let child;
  let exited;
  let socket;
  let lines;
  let childError;
  let socketError;
  let stderr = '';
  const abortSocket = () => socket?.destroy();
  signal.addEventListener('abort', abortSocket);

  try {
    await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    await mkdir(path.dirname(taskPath), { recursive: true });
    await exec('git', ['init', '-q'], options);
    await writeFile(path.join(project, '.jeff/config.json'), JSON.stringify({
      schemaVersion: 1, system: 'jeff', mode: 'lite', active: true,
    }));
    await writeTask(taskPath, 'One');
    await writeFile(path.join(home, '.jeff/projects.json'), JSON.stringify([{
      id: 'example', path: project, name: 'Synthetic example', enabled: true,
      cook: [process.execPath, cook],
    }]), { mode: 0o600 });

    console.log(`Example project: ${project}`);
    child = spawn(jeffd, ['start'], { env, cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    exited = new Promise((resolve) => {
      child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
      child.once('error', (error) => {
        childError = error;
        resolve({ code: null, error });
      });
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });

    const readyBy = Date.now() + 10_000;
    while (true) {
      signal.throwIfAborted();
      if (childError) throw childError;
      assert.equal(child.exitCode, null, `daemon exited during startup: ${stderr}`);
      assert.equal(child.signalCode, null, `daemon was killed during startup: ${stderr}`);
      socket = net.createConnection(socketPath);
      socket.on('error', (error) => { socketError = error; lines?.close(); });
      try {
        await once(socket, 'connect', { signal });
        break;
      } catch (error) {
        socket.destroy();
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) || Date.now() >= readyBy) throw error;
        await delay(25, undefined, { signal });
      }
    }
    socketError = undefined;
    lines = createInterface({ input: socket, crlfDelay: Infinity, signal });
    const frames = lines[Symbol.asyncIterator]();

    async function receive(predicate) {
      while (true) {
        signal.throwIfAborted();
        const next = await frames.next();
        signal.throwIfAborted();
        if (socketError) throw socketError;
        assert.equal(next.done, false, `connection ended before expected frame: ${stderr}`);
        const frame = JSON.parse(next.value);
        assert.equal(frame.v, 1);
        assert.notEqual(frame.name, 'snapshot.failed', JSON.stringify(frame));
        if (predicate(frame)) return frame;
      }
    }

    async function request(id, method, params = {}) {
      socket.write(`${JSON.stringify({ v: 1, kind: 'req', id, method, params })}\n`);
      const response = await receive((frame) => frame.kind === 'res' && frame.id === id);
      assert.equal(response.ok, true, JSON.stringify(response));
      return response.result;
    }

    const hello = await request('hello', 'server.hello');
    assert.equal(hello.protocolVersion, 1);
    console.log(`Daemon ${hello.serverVersion}, protocol ${hello.protocolVersion}`);
    assertTitle(await request('get', 'snapshot.get', { projectId: 'example' }), 'One');
    console.log('snapshot.get: task 1, title "One"');
    const subscription = await request('subscribe', 'snapshot.subscribe', { projectId: 'example' });
    assert.equal(typeof subscription.subscriptionId, 'string');
    assertTitle(subscription.snapshot, 'One');
    console.log(`snapshot.subscribe: ${subscription.subscriptionId}`);

    await writeTask(taskPath, 'One replaced');
    const update = await receive((frame) => frame.kind === 'event'
      && frame.name === 'snapshot.replaced' && frame.payload?.projectId === 'example'
      && frame.payload.snapshot?.tasks?.[0]?.title === 'One replaced');
    assertTitle(update.payload.snapshot, 'One replaced');
    console.log('snapshot.replaced: task 1, title "One replaced"');

    socket.destroy();
    await exec(jeffd, ['stop'], options);
    const status = await Promise.race([
      exited,
      delay(10_000, undefined, { signal }).then(() => { throw new Error('daemon did not exit after stop'); }),
    ]);
    assert.equal(status.code, 0, `daemon did not stop cleanly: ${stderr}`);
    await assert.rejects(access(socketPath), { code: 'ENOENT' });
    console.log('jeffd stop: exit 0, socket removed');
  } finally {
    lines?.close();
    socket?.destroy();
    signal.removeEventListener('abort', abortSocket);
    controller.abort();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(force);
    }
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
    console.log('Temporary project and home removed');
  }
}

main().catch((error) => {
  console.error(`demo: ${error.message}`);
  process.exitCode ||= 1;
}).finally(() => clearTimeout(timeout));
