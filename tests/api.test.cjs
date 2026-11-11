const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');
const { createApp } = require('../server/app.cjs');

test('backlog migration preserves existing tasks and accepts the new status', () => {
  const db = newDb();
  const schema = fs.readFileSync(path.join(__dirname, '../server/schema.sql'), 'utf8').replace("'Backlog', ", '');
  db.public.none(schema);
  db.public.none("INSERT INTO tasks (title, status, priority) VALUES ('Existing task', 'To do', 'Low')");
  db.public.none(fs.readFileSync(path.join(__dirname, '../server/backlog-migration.sql'), 'utf8'));
  db.public.none(fs.readFileSync(path.join(__dirname, '../server/backlog-migration.sql'), 'utf8'));
  db.public.none("INSERT INTO tasks (title, status, priority) VALUES ('Upcoming task', 'Backlog', 'High')");
  const rows = db.public.many('SELECT title, status FROM tasks ORDER BY id');
  assert.deepEqual(rows.map(({ title, status }) => ({ title, status })), [
    { title: 'Existing task', status: 'To do' },
    { title: 'Upcoming task', status: 'Backlog' },
  ]);
});

test('accounts share tasks, sessions are protected, and conflicting updates are rejected', async (t) => {
  const db = newDb();
  db.public.none(fs.readFileSync(path.join(__dirname, '../server/schema.sql'), 'utf8'));
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const server = createApp(pool, { secureCookies: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(url, method = 'GET', body, cookie) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await call('/tasks')).status, 401);
  const nonJson = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(nonJson.status, 415);
  const crossSite = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  assert.equal(crossSite.status, 403);
  assert.equal((await call('/auth/signup', 'POST', { username: 'bad!', password: 'short' })).status, 400);
  const alice = await call('/auth/signup', 'POST', { username: 'Alice', password: 'longpassword123' });
  assert.equal(alice.status, 200);
  assert.equal(alice.data.user.username, 'alice');
  assert.equal((await call('/auth/signup', 'POST', { username: 'ALICE', password: 'longpassword123' })).status, 409);
  const bob = await call('/auth/signup', 'POST', { username: 'Bob', password: 'longpassword456' });
  assert.equal(bob.status, 200);
  assert.equal((await call('/auth/login', 'POST', { username: 'alice', password: 'wrongpassword123' })).status, 401);
  const login = await call('/auth/login', 'POST', { username: 'ALICE', password: 'longpassword123' });
  assert.equal(login.status, 200);
  const task = { title: 'Shared work', description: '', status: 'To do', priority: 'High', assignee: 'alice', label: '' };
  const backlog = await call('/tasks', 'POST', { ...task, title: 'Upcoming', status: 'Backlog' }, alice.cookie);
  assert.equal(backlog.status, 201);
  assert.equal((await call('/tasks', 'GET', undefined, bob.cookie)).data.tasks[0].status, 'Backlog');
  const planned = await call(`/tasks/${backlog.data.task.id}`, 'PUT', { ...backlog.data.task, status: 'To do' }, bob.cookie);
  assert.equal(planned.data.task.status, 'To do');
  assert.equal((await call(`/tasks/${backlog.data.task.id}`, 'PUT', { ...backlog.data.task, status: 'To do' }, alice.cookie)).status, 409);
  const returned = await call(`/tasks/${backlog.data.task.id}`, 'PUT', { ...planned.data.task, status: 'Backlog' }, alice.cookie);
  assert.equal(returned.data.task.status, 'Backlog');
  assert.equal((await call(`/tasks/${backlog.data.task.id}`, 'DELETE', { version: returned.data.task.version }, alice.cookie)).status, 200);
  assert.equal((await call('/tasks', 'POST', { ...task, status: 'invalid' }, alice.cookie)).status, 400);
  const created = await call('/tasks', 'POST', task, alice.cookie);
  assert.equal(created.status, 201);
  assert.match(created.data.task.id, /^ORB-\d+$/);
  const shared = await call('/tasks', 'GET', undefined, bob.cookie);
  assert.equal(shared.data.tasks.length, 1);
  assert.equal(shared.data.tasks[0].title, 'Shared work');
  const updated = await call(`/tasks/${created.data.task.id}`, 'PUT', { ...created.data.task, status: 'In progress' }, bob.cookie);
  assert.equal(updated.data.task.version, 2);
  assert.equal((await call(`/tasks/${created.data.task.id}`, 'PUT', created.data.task, alice.cookie)).status, 409);
  assert.equal((await call(`/tasks/${created.data.task.id}`, 'DELETE', { version: 1 }, alice.cookie)).status, 409);
  assert.equal((await call(`/tasks/${created.data.task.id}`, 'DELETE', { version: 2 }, alice.cookie)).status, 200);
  assert.equal((await call('/tasks', 'GET', undefined, bob.cookie)).data.tasks.length, 0);
  assert.equal((await call('/auth/logout', 'POST', {}, alice.cookie)).status, 200);
  assert.equal((await call('/tasks', 'GET', undefined, alice.cookie)).status, 401);
  assert.equal((await call('/tasks', 'GET', undefined, bob.cookie)).status, 200);
});
