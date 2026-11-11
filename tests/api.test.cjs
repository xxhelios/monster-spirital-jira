const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');
const { createApp } = require('../server/app.cjs');

test('existing board name and tasks migrate to the original project', () => {
  const db = newDb();
  db.public.none("CREATE TABLE board_settings (id integer primary key, title text not null, version integer not null); INSERT INTO board_settings VALUES (1, 'Existing team', 4); CREATE TABLE tasks (id serial primary key, title text not null); INSERT INTO tasks (title) VALUES ('Existing task')");
  db.public.none('CREATE TABLE projects (id text primary key, title varchar(120) not null, version integer not null default 1, archived boolean not null default false)');
  db.public.none("INSERT INTO projects (id, title, version) SELECT 'default', title, version FROM board_settings WHERE id = 1 ON CONFLICT (id) DO NOTHING");
  db.public.none("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id)");
  assert.equal(db.public.one("SELECT title FROM projects WHERE id = 'default'").title, 'Existing team');
  assert.equal(db.public.one('SELECT project_id FROM tasks').project_id, 'default');
  db.public.none("UPDATE projects SET title = 'Renamed' WHERE id = 'default'");
  db.public.none("INSERT INTO projects (id, title, version) SELECT 'default', title, version FROM board_settings WHERE id = 1 ON CONFLICT (id) DO NOTHING");
  assert.equal(db.public.one("SELECT title FROM projects WHERE id = 'default'").title, 'Renamed');
});

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
  assert.equal((await call('/projects')).status, 401);
  assert.equal((await call('/users')).status, 401);
  assert.equal((await call('/projects/default/tasks')).status, 401);
  assert.equal((await call('/projects/default', 'PATCH', { title: 'Denied', version: 1, archived: false })).status, 401);
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
  assert.deepEqual((await call('/users', 'GET', undefined, alice.cookie)).data, { users: [{ username: 'alice' }, { username: 'bob' }] });
  const board = await call('/projects', 'GET', undefined, alice.cookie);
  assert.deepEqual(board.data.projects[0], { id: 'default', title: 'Project board', version: 1, archived: false, total: 0, completed: 0 });
  assert.equal((await call('/projects/default', 'PATCH', { title: '   ', version: 1, archived: false }, alice.cookie)).status, 400);
  assert.equal((await call('/projects/default', 'PATCH', { title: 'x'.repeat(121), version: 1, archived: false }, alice.cookie)).status, 400);
  assert.equal((await call('/projects/default', 'PATCH', { title: 'New board' }, alice.cookie)).status, 400);
  const renamed = await call('/projects/default', 'PATCH', { title: '  Team board  ', version: 1, archived: false }, alice.cookie);
  assert.deepEqual(renamed.data.project, { id: 'default', title: 'Team board', version: 2, archived: false });
  db.public.none("INSERT INTO board_settings (id, title) VALUES (1, 'Project board') ON CONFLICT (id) DO NOTHING");
  assert.equal((await call('/projects', 'GET', undefined, bob.cookie)).data.projects[0].title, 'Team board');
  assert.equal((await call('/projects/default', 'PATCH', { title: 'Old edit', version: 1, archived: false }, bob.cookie)).status, 409);
  assert.equal((await call('/auth/login', 'POST', { username: 'alice', password: 'wrongpassword123' })).status, 401);
  const login = await call('/auth/login', 'POST', { username: 'ALICE', password: 'longpassword123' });
  assert.equal(login.status, 200);
  const task = { title: 'Shared work', description: '', status: 'To do', priority: 'High', assignee: 'alice', label: '' };
  const backlog = await call('/projects/default/tasks', 'POST', { ...task, title: 'Upcoming', status: 'Backlog' }, alice.cookie);
  assert.equal(backlog.status, 201);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, bob.cookie)).data.tasks[0].status, 'Backlog');
  const planned = await call(`/projects/default/tasks/${backlog.data.task.id}`, 'PUT', { ...backlog.data.task, status: 'To do' }, bob.cookie);
  assert.equal(planned.data.task.status, 'To do');
  assert.equal((await call(`/projects/default/tasks/${backlog.data.task.id}`, 'PUT', { ...backlog.data.task, status: 'To do' }, alice.cookie)).status, 409);
  const returned = await call(`/projects/default/tasks/${backlog.data.task.id}`, 'PUT', { ...planned.data.task, status: 'Backlog' }, alice.cookie);
  assert.equal(returned.data.task.status, 'Backlog');
  assert.equal((await call(`/projects/default/tasks/${backlog.data.task.id}`, 'DELETE', { version: returned.data.task.version }, alice.cookie)).status, 200);
  assert.equal((await call('/projects/default/tasks', 'POST', { ...task, status: 'invalid' }, alice.cookie)).status, 400);
  const created = await call('/projects/default/tasks', 'POST', task, alice.cookie);
  assert.equal(created.status, 201);
  assert.match(created.data.task.id, /^ORB-\d+$/);
  const shared = await call('/projects/default/tasks', 'GET', undefined, bob.cookie);
  assert.equal(shared.data.tasks.length, 1);
  assert.equal(shared.data.tasks[0].title, 'Shared work');
  const updated = await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', { ...created.data.task, status: 'In progress' }, bob.cookie);
  assert.equal(updated.data.task.version, 2);
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', created.data.task, alice.cookie)).status, 409);
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'DELETE', { version: 1 }, alice.cookie)).status, 409);
  const second = await call('/projects', 'POST', { title: 'Second project' }, bob.cookie);
  assert.equal(second.status, 201);
  const secondId = second.data.project.id;
  assert.equal((await call(`/projects/${secondId}/tasks`, 'GET', undefined, bob.cookie)).data.tasks.length, 0);
  assert.equal((await call(`/projects/${secondId}/tasks/${created.data.task.id}`, 'DELETE', { version: 2 }, bob.cookie)).status, 409);
  const secondTask = await call(`/projects/${secondId}/tasks`, 'POST', { ...task, status: 'Done' }, bob.cookie);
  assert.equal(secondTask.status, 201);
  const listed = (await call('/projects', 'GET', undefined, alice.cookie)).data.projects;
  assert.deepEqual(listed.find((project) => project.id === secondId).completed, 1);
  assert.deepEqual(listed.find((project) => project.id === 'default').completed, 0);
  const archived = await call(`/projects/${secondId}`, 'PATCH', { ...second.data.project, archived: true }, alice.cookie);
  assert.equal(archived.data.project.archived, true);
  assert.equal((await call(`/projects/${secondId}/tasks`, 'GET', undefined, bob.cookie)).status, 404);
  assert.equal((await call(`/projects/${secondId}/tasks`, 'POST', task, bob.cookie)).status, 404);
  const restored = await call(`/projects/${secondId}`, 'PATCH', { ...archived.data.project, archived: false }, bob.cookie);
  assert.equal(restored.data.project.archived, false);
  assert.equal((await call(`/projects/${secondId}/tasks`, 'GET', undefined, bob.cookie)).data.tasks.length, 1);
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'DELETE', { version: 2 }, alice.cookie)).status, 200);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, bob.cookie)).data.tasks.length, 0);
  assert.equal((await call('/auth/logout', 'POST', {}, alice.cookie)).status, 200);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, alice.cookie)).status, 401);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, bob.cookie)).status, 200);
});
