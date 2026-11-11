const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomBytes, randomUUID, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');

const scrypt = promisify(scryptCallback);
const cookieName = 'orbit_session';
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const statuses = ['Backlog', 'To do', 'In progress', 'In Review', 'Done'];
const priorities = ['Low', 'Medium', 'High'];
const accentColors = ['peach', 'lavender', 'mint', 'blue', 'rose', 'gold'];
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const taskFromRow = (row) => ({ ...row, id: `MSC-${String(row.id).padStart(4, '0')}` });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(username);
}

function validCredentials(body) {
  return body && validUsername(body.username) &&
    typeof body.password === 'string' && body.password.length > 0;
}

function validSignupPassword(password) {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

function validTask(body) {
  return body && typeof body.title === 'string' && body.title.trim().length > 0 && body.title.trim().length <= 120 &&
    typeof body.description === 'string' && body.description.trim().length <= 1000 &&
    statuses.includes(body.status) && priorities.includes(body.priority) &&
    typeof body.assignee === 'string' && body.assignee.trim().length <= 80 &&
    typeof body.label === 'string' && body.label.trim().length <= 40;
}

function taskId(value) {
  const match = /^(?:MSC-(\d{4,})|ORB-([1-9]\d*))$/.exec(value);
  if (!match) return null;
  const id = Number(match[1] ?? match[2]);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function createApp(pool, options = {}) {
  const app = express();
  const secure = options.secureCookies ?? process.env.NODE_ENV === 'production';
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Requests must use JSON.' });
    }
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
  });
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: sessionDuration };

  async function createSession(user, res) {
    const token = randomBytes(32).toString('hex');
    await pool.query('DELETE FROM sessions WHERE expires_at <= $1', [new Date()]);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash(token), user.id, new Date(Date.now() + sessionDuration)]);
    res.cookie(cookieName, token, cookieOptions);
    res.json({ user: { username: user.username } });
  }

  app.post('/api/auth/signup', authLimit, asyncRoute(async (req, res) => {
    if (!validCredentials(req.body) || !validSignupPassword(req.body.password)) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, underscores or hyphens; password must be at least 8 characters and contain letters and numbers.' });
    const username = req.body.username.toLowerCase();
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(req.body.password, salt, 64)).toString('hex');
    let result;
    try {
      result = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, `${salt}:${hash}`]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That username is already in use.' });
      throw error;
    }
    await createSession(result.rows[0], res);
  }));
  app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => {
    if (!validCredentials(req.body)) return res.status(401).json({ error: 'Invalid username or password.' });
    const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [req.body.username.toLowerCase()]);
    const user = result.rows[0];
    const [salt, stored] = user ? user.password_hash.split(':') : ['00000000000000000000000000000000', '0'.repeat(128)];
    const hash = await scrypt(req.body.password, salt, 64);
    if (!user || !timingSafeEqual(hash, Buffer.from(stored, 'hex'))) return res.status(401).json({ error: 'Invalid username or password.' });
    await createSession(user, res);
  }));

  const authenticate = asyncRoute(async (req, res, next) => {
    const token = req.cookies[cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Please sign in.' });
    const result = await pool.query('SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = $1 AND sessions.expires_at > $2', [tokenHash(token), new Date()]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.user = result.rows[0];
    next();
  });
  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: { username: req.user.username } }));
  app.patch('/api/auth/color', authenticate, asyncRoute(async (req, res) => {
    if (!req.body || !accentColors.includes(req.body.color)) return res.status(400).json({ error: 'Choose a valid accent color.' });
    const result = await pool.query('UPDATE users SET accent_color = $1 WHERE id = $2 RETURNING username, accent_color', [req.body.color, req.user.id]);
    if (!result.rowCount) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    res.json({ user: result.rows[0] });
  }));
  app.patch('/api/auth/account', authLimit, authenticate, asyncRoute(async (req, res) => {
    const { currentPassword, username, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword ||
      (username === undefined) === (newPassword === undefined)) {
      return res.status(400).json({ error: 'Enter your current password and choose one account change.' });
    }
    if (username !== undefined && !validUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, underscores or hyphens.' });
    }
    if (newPassword !== undefined && (typeof newPassword !== 'string' || !validSignupPassword(newPassword))) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and contain letters and numbers.' });
    }
    const result = await pool.query('SELECT username, password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rowCount) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    const user = result.rows[0];
    const [salt, stored] = user.password_hash.split(':');
    const hash = await scrypt(currentPassword, salt, 64);
    if (!timingSafeEqual(hash, Buffer.from(stored, 'hex'))) return res.status(403).json({ error: 'Current password is incorrect.' });

    let passwordHash = user.password_hash;
    if (newPassword !== undefined) {
      const newSalt = randomBytes(16).toString('hex');
      passwordHash = `${newSalt}:${(await scrypt(newPassword, newSalt, 64)).toString('hex')}`;
    }
    const newUsername = username === undefined ? user.username : username.toLowerCase();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query('UPDATE users SET username = $1, password_hash = $2 WHERE id = $3 AND username = $4 AND password_hash = $5 RETURNING username', [newUsername, passwordHash, req.user.id, user.username, user.password_hash]);
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Your account changed. Please try again.' });
      }
      if (newUsername !== user.username) {
        await client.query('UPDATE tasks SET assignee = $1, version = version + 1 WHERE assignee = $2', [newUsername, user.username]);
      }
      if (newPassword !== undefined) {
        await client.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, tokenHash(req.cookies[cookieName])]);
      }
      await client.query('COMMIT');
      res.json({ user: { username: newUsername } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'That username is already in use.' });
      throw error;
    } finally {
      client.release();
    }
  }));
  app.post('/api/auth/logout', authenticate, asyncRoute(async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(req.cookies[cookieName])]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  }));
  app.get('/api/users', authenticate, asyncRoute(async (req, res) => {
    const result = await pool.query('SELECT username, accent_color FROM users ORDER BY username');
    res.json({ users: result.rows });
  }));
  app.get('/api/projects', authenticate, asyncRoute(async (req, res) => {
    const projects = await pool.query('SELECT id, title, version, archived FROM projects ORDER BY title, id');
    const tasks = await pool.query('SELECT project_id, status FROM tasks');
    const counts = new Map();
    for (const task of tasks.rows) {
      if (task.status === 'Backlog') continue;
      const count = counts.get(task.project_id) || { total: 0, completed: 0 };
      count.total++;
      if (task.status === 'Done') count.completed++;
      counts.set(task.project_id, count);
    }
    res.json({ projects: projects.rows.map((project) => ({ ...project, ...(counts.get(project.id) || { total: 0, completed: 0 }) })) });
  }));
  app.post('/api/projects', authenticate, asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 120) {
      return res.status(400).json({ error: 'Project title must be between 1 and 120 characters.' });
    }
    const result = await pool.query('INSERT INTO projects (id, title) VALUES ($1, $2) RETURNING id, title, version, archived', [randomUUID(), req.body.title.trim()]);
    res.status(201).json({ project: result.rows[0] });
  }));
  app.patch('/api/projects/:projectId', authenticate, asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body.title !== 'string' || !req.body.title.trim() ||
      req.body.title.trim().length > 120 || typeof req.body.archived !== 'boolean' || !Number.isSafeInteger(req.body.version) || req.body.version < 1) {
      return res.status(400).json({ error: 'Invalid project details.' });
    }
    const result = await pool.query('UPDATE projects SET title = $1, archived = $2, version = version + 1 WHERE id = $3 AND version = $4 RETURNING id, title, version, archived', [req.body.title.trim(), req.body.archived, req.params.projectId, req.body.version]);
    if (!result.rowCount) return res.status(409).json({ error: 'This project changed. Refresh and try again.' });
    res.json({ project: result.rows[0] });
  }));
  const activeProject = asyncRoute(async (req, res, next) => {
    const result = await pool.query('SELECT id FROM projects WHERE id = $1 AND archived = false', [req.params.projectId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Project not found or archived.' });
    next();
  });
  app.get('/api/projects/:projectId/tasks', authenticate, activeProject, asyncRoute(async (req, res) => {
    const result = await pool.query('SELECT id, title, description, status, priority, assignee, label, version FROM tasks WHERE project_id = $1 ORDER BY id', [req.params.projectId]);
    res.json({ tasks: result.rows.map(taskFromRow) });
  }));
  app.post('/api/projects/:projectId/tasks', authenticate, activeProject, asyncRoute(async (req, res) => {
    if (!validTask(req.body)) return res.status(400).json({ error: 'Invalid task details.' });
    const { title, description, status, priority, assignee, label } = req.body;
    const result = await pool.query('INSERT INTO tasks (title, description, status, priority, assignee, label, project_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title, description, status, priority, assignee, label, version', [title.trim(), description.trim(), status, priority, assignee.trim(), label.trim(), req.params.projectId]);
    res.status(201).json({ task: taskFromRow(result.rows[0]) });
  }));
  app.put('/api/projects/:projectId/tasks/:id', authenticate, activeProject, asyncRoute(async (req, res) => {
    const id = taskId(req.params.id);
    if (!id || !validTask(req.body) || !Number.isSafeInteger(req.body.version) || req.body.version < 1) return res.status(400).json({ error: 'Invalid task details.' });
    const { title, description, status, priority, assignee, label, version } = req.body;
    const result = await pool.query('UPDATE tasks SET title=$1, description=$2, status=$3, priority=$4, assignee=$5, label=$6, version=version+1 WHERE id=$7 AND version=$8 AND project_id=$9 RETURNING id, title, description, status, priority, assignee, label, version', [title.trim(), description.trim(), status, priority, assignee.trim(), label.trim(), id, version, req.params.projectId]);
    if (!result.rowCount) return res.status(409).json({ error: 'This task was changed or deleted by someone else. Refresh and try again.' });
    res.json({ task: taskFromRow(result.rows[0]) });
  }));
  app.delete('/api/projects/:projectId/tasks/:id', authenticate, activeProject, asyncRoute(async (req, res) => {
    const id = taskId(req.params.id);
    if (!id || !Number.isSafeInteger(req.body?.version) || req.body.version < 1) return res.status(400).json({ error: 'Invalid task details.' });
    const result = await pool.query('DELETE FROM tasks WHERE id=$1 AND version=$2 AND project_id=$3', [id, req.body.version, req.params.projectId]);
    if (!result.rowCount) return res.status(409).json({ error: 'This task was changed or deleted by someone else. Refresh and try again.' });
    res.json({ ok: true });
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(express.static(path.resolve(__dirname, '..', 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.resolve(__dirname, '..', 'dist', 'index.html')));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error('Request failed:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

module.exports = { createApp };
