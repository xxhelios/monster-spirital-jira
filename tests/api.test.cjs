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

test('status migration preserves existing tasks and is repeatable with review tasks', () => {
  const db = newDb();
  const schema = fs.readFileSync(path.join(__dirname, '../server/schema.sql'), 'utf8').replace("'Backlog', ", '').replace("'In Review', ", '');
  db.public.none(schema);
  db.public.none("INSERT INTO tasks (title, status, priority) VALUES ('Existing task', 'To do', 'Low')");
  assert.throws(() => db.public.none("INSERT INTO tasks (title, status, priority) VALUES ('Review task', 'In Review', 'Low')"));
  db.public.none(fs.readFileSync(path.join(__dirname, '../server/backlog-migration.sql'), 'utf8'));
  db.public.none("INSERT INTO tasks (title, status, priority) VALUES ('Upcoming task', 'Backlog', 'High')");
  db.public.none("INSERT INTO tasks (title, status, priority) VALUES ('Review task', 'In Review', 'Medium')");
  db.public.none(fs.readFileSync(path.join(__dirname, '../server/backlog-migration.sql'), 'utf8'));
  const rows = db.public.many('SELECT title, status FROM tasks ORDER BY id');
  assert.deepEqual(rows.map(({ title, status }) => ({ title, status })), [
    { title: 'Existing task', status: 'To do' },
    { title: 'Upcoming task', status: 'Backlog' },
    { title: 'Review task', status: 'In Review' },
  ]);
});

test('accent color migration preserves existing users and is repeatable', () => {
  const db = newDb();
  db.public.none('CREATE TABLE users (id serial primary key, username text not null); INSERT INTO users (username) VALUES (\'existing\')');
  const migration = fs.readFileSync(path.join(__dirname, '../server/migrate.cjs'), 'utf8');
  const query = migration.match(/client\.query\('(ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color [^']+)'\)/);
  assert.ok(query);
  db.public.none(query[1]);
  db.public.none("UPDATE users SET accent_color = 'mint' WHERE username = 'existing'");
  db.public.none(query[1]);
  assert.equal(db.public.one("SELECT accent_color FROM users WHERE username = 'existing'").accent_color, 'mint');
});

test('ticket identifiers preserve numeric IDs and accept legacy API references', async (t) => {
  const db = newDb();
  db.public.none(fs.readFileSync(path.join(__dirname, '../server/schema.sql'), 'utf8'));
  db.public.none("INSERT INTO tasks (id, title, status, priority) VALUES (9, 'Existing', 'Backlog', 'Low'), (9999, 'Four digits', 'To do', 'Low'), (10000, 'Five digits', 'To do', 'Low')");
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
  const signup = await call('/auth/signup', 'POST', { username: 'ticketuser', password: 'password1' });
  const tasks = (await call('/projects/default/tasks', 'GET', undefined, signup.cookie)).data.tasks;
  assert.deepEqual(tasks.map((task) => task.id), ['MSC-0009', 'MSC-9999', 'MSC-10000']);
  const legacyUpdate = await call('/projects/default/tasks/ORB-9', 'PUT', { ...tasks[0], title: 'Updated' }, signup.cookie);
  assert.equal(legacyUpdate.status, 200);
  assert.equal(legacyUpdate.data.task.id, 'MSC-0009');
  assert.equal((await call('/projects/default/tasks/MSC-0009', 'DELETE', { version: legacyUpdate.data.task.version }, signup.cookie)).status, 200);
  for (const id of ['MSC-0000', 'MSC-001', 'MSC--0001', 'MSC-2147483648', 'ORB-0', 'ORB-0009']) {
    assert.equal((await call(`/projects/default/tasks/${id}`, 'DELETE', { version: 1 }, signup.cookie)).status, 400, id);
  }
  assert.equal((await call('/projects/default/tasks/MSC-10000', 'DELETE', { version: 1 }, signup.cookie)).status, 200);
});

test('account changes require the current password and preserve assignments', async (t) => {
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
  const alice = await call('/auth/signup', 'POST', { username: 'Alice', password: 'password1' });
  const otherSession = await call('/auth/login', 'POST', { username: 'alice', password: 'password1' });
  const bob = await call('/auth/signup', 'POST', { username: 'bob', password: 'password2' });
  assert.equal((await call('/auth/color', 'PATCH', { color: 'mint' })).status, 401);
  assert.equal((await call('/auth/color', 'PATCH', { color: 'invalid' }, alice.cookie)).status, 400);
  assert.equal((await call('/auth/color', 'PATCH', {}, alice.cookie)).status, 400);
  for (const color of ['peach', 'lavender', 'mint', 'blue', 'rose', 'gold']) {
    const changed = await call('/auth/color', 'PATCH', { color }, alice.cookie);
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.accent_color, color);
  }
  assert.equal((await call('/auth/color', 'PATCH', { color: 'rose', username: 'bob' }, alice.cookie)).status, 200);
  assert.deepEqual((await call('/users', 'GET', undefined, bob.cookie)).data.users, [
    { username: 'alice', accent_color: 'rose' }, { username: 'bob', accent_color: null },
  ]);
  assert.deepEqual((await call('/users', 'GET', undefined, otherSession.cookie)).data.users[0], { username: 'alice', accent_color: 'rose' });
  const task = { title: 'Assigned', description: '', status: 'To do', priority: 'Low', assignee: 'alice', label: '' };
  const created = await call('/projects/default/tasks', 'POST', task, alice.cookie);
  db.public.none("INSERT INTO projects (id, title, archived) VALUES ('archived', 'Archived', true)");
  db.public.none("INSERT INTO tasks (title, status, priority, assignee, project_id) VALUES ('Archived task', 'Backlog', 'Low', 'alice', 'archived'), ('Legacy', 'To do', 'Low', 'someone else', 'default')");

  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'password1', username: 'newname' })).status, 401);
  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'wrong', username: 'newname' }, alice.cookie)).status, 403);
  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'password1', username: 'bad!' }, alice.cookie)).status, 400);
  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'password1', username: 'BOB' }, alice.cookie)).status, 409);
  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'password1', username: 'newname', newPassword: 'password3' }, alice.cookie)).status, 400);
  const rename = await call('/auth/account', 'PATCH', { currentPassword: 'password1', username: 'NewName' }, alice.cookie);
  assert.equal(rename.status, 200);
  assert.equal(rename.data.user.username, 'newname');
  assert.deepEqual((await call('/users', 'GET', undefined, bob.cookie)).data.users.find((user) => user.username === 'newname'), { username: 'newname', accent_color: 'rose' });
  assert.equal((await call('/auth/me', 'GET', undefined, alice.cookie)).data.user.username, 'newname');
  assert.equal((await call('/auth/login', 'POST', { username: 'alice', password: 'password1' })).status, 401);
  const rows = db.public.many('SELECT assignee, version FROM tasks ORDER BY id');
  assert.deepEqual(rows.map(({ assignee, version }) => ({ assignee, version })), [
    { assignee: 'newname', version: 2 },
    { assignee: 'newname', version: 2 },
    { assignee: 'someone else', version: 1 },
  ]);
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', created.data.task, alice.cookie)).status, 409);
  for (const password of ['abc1234', 'abcdefgh', '12345678']) {
    assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'password1', newPassword: password }, alice.cookie)).status, 400);
  }
  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'wrong', newPassword: 'password3' }, alice.cookie)).status, 403);
  assert.equal((await call('/auth/account', 'PATCH', { currentPassword: 'password1', newPassword: 'abcdefg1' }, alice.cookie)).status, 200);
  assert.equal((await call('/auth/me', 'GET', undefined, alice.cookie)).status, 200);
  assert.equal((await call('/auth/me', 'GET', undefined, otherSession.cookie)).status, 401);
  assert.equal((await call('/auth/login', 'POST', { username: 'newname', password: 'password1' })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { username: 'newname', password: 'abcdefg1' })).status, 200);
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
  for (const password of ['abc1234', 'abcdefgh', '12345678']) {
    assert.equal((await call('/auth/signup', 'POST', { username: 'charlie', password })).status, 400);
  }
  assert.equal((await call('/auth/signup', 'POST', { username: 'charlie', password: 'abcdefg1' })).status, 200);
  assert.equal((await call('/auth/signup', 'POST', { username: 'longpass', password: `${'a'.repeat(128)}1` })).status, 200);
  const alice = await call('/auth/signup', 'POST', { username: 'Alice', password: 'longpassword123' });
  assert.equal(alice.status, 200);
  assert.equal(alice.data.user.username, 'alice');
  assert.equal((await call('/auth/signup', 'POST', { username: 'ALICE', password: 'longpassword123' })).status, 409);
  const bob = await call('/auth/signup', 'POST', { username: 'Bob', password: 'longpassword456' });
  assert.equal(bob.status, 200);
  assert.deepEqual((await call('/users', 'GET', undefined, alice.cookie)).data, { users: [{ username: 'alice', accent_color: null }, { username: 'bob', accent_color: null }, { username: 'charlie', accent_color: null }, { username: 'longpass', accent_color: null }] });
  assert.equal((await call('/auth/login', 'POST', { username: 'charlie', password: 'abcdefg1' })).status, 200);
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
  const legacy = await call('/auth/signup', 'POST', { username: 'legacy', password: 'abcdefgh1' });
  assert.equal(legacy.status, 200);
  const { scryptSync } = require('node:crypto');
  const salt = '0123456789abcdef0123456789abcdef';
  await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [`${salt}:${scryptSync('letters-only-password', salt, 64).toString('hex')}`, 'legacy']);
  assert.equal((await call('/auth/login', 'POST', { username: 'legacy', password: 'letters-only-password' })).status, 200);
  const task = { title: 'Shared work', description: '', status: 'To do', priority: 'High', assignee: 'alice', label: '' };
  const backlog = await call('/projects/default/tasks', 'POST', { ...task, title: 'Upcoming', status: 'Backlog' }, alice.cookie);
  assert.equal(backlog.status, 201);
  assert.equal(backlog.data.task.id, 'MSC-0001');
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
  assert.equal(created.data.task.id, 'MSC-0002');
  const shared = await call('/projects/default/tasks', 'GET', undefined, bob.cookie);
  assert.equal(shared.data.tasks.length, 1);
  assert.equal(shared.data.tasks[0].title, 'Shared work');
  const updated = await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', { ...created.data.task, status: 'In progress' }, bob.cookie);
  assert.equal(updated.data.task.version, 2);
  const review = await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', { ...updated.data.task, status: 'In Review' }, alice.cookie);
  assert.equal(review.status, 200);
  assert.equal(review.data.task.status, 'In Review');
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, bob.cookie)).data.tasks[0].status, 'In Review');
  const projectWithReview = (await call('/projects', 'GET', undefined, alice.cookie)).data.projects.find((project) => project.id === 'default');
  assert.equal(projectWithReview.total, 1);
  assert.equal(projectWithReview.completed, 0);
  const done = await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', { ...review.data.task, status: 'Done' }, bob.cookie);
  assert.equal(done.data.task.status, 'Done');
  assert.equal((await call('/projects', 'GET', undefined, alice.cookie)).data.projects.find((project) => project.id === 'default').completed, 1);
  const reopened = await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', { ...done.data.task, status: 'In progress' }, alice.cookie);
  assert.equal(reopened.data.task.status, 'In progress');
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'PUT', created.data.task, alice.cookie)).status, 409);
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'DELETE', { version: 1 }, alice.cookie)).status, 409);
  const second = await call('/projects', 'POST', { title: 'Second project' }, bob.cookie);
  assert.equal(second.status, 201);
  const secondId = second.data.project.id;
  assert.equal((await call(`/projects/${secondId}/tasks`, 'GET', undefined, bob.cookie)).data.tasks.length, 0);
  assert.equal((await call(`/projects/${secondId}/tasks/${created.data.task.id}`, 'DELETE', { version: reopened.data.task.version }, bob.cookie)).status, 409);
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
  assert.equal((await call(`/projects/default/tasks/${created.data.task.id}`, 'DELETE', { version: reopened.data.task.version }, alice.cookie)).status, 200);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, bob.cookie)).data.tasks.length, 0);
  assert.equal((await call('/auth/logout', 'POST', {}, alice.cookie)).status, 200);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, alice.cookie)).status, 401);
  assert.equal((await call('/projects/default/tasks', 'GET', undefined, bob.cookie)).status, 200);
});
