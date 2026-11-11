const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');

const scrypt = promisify(scryptCallback);
const cookieName = 'orbit_session';
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const statuses = ['To do', 'In progress', 'Done'];
const priorities = ['Low', 'Medium', 'High'];
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const taskFromRow = (row) => ({ ...row, id: `ORB-${row.id}` });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validCredentials(body) {
  return body && typeof body.username === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(body.username) &&
    typeof body.password === 'string' && body.password.length >= 12 && body.password.length <= 128;
}

function validTask(body) {
  return body && typeof body.title === 'string' && body.title.trim().length > 0 && body.title.trim().length <= 120 &&
    typeof body.description === 'string' && body.description.trim().length <= 1000 &&
    statuses.includes(body.status) && priorities.includes(body.priority) &&
    typeof body.assignee === 'string' && body.assignee.trim().length <= 80 &&
    typeof body.label === 'string' && body.label.trim().length <= 40;
}

function taskId(value) {
  const match = /^ORB-([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
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
    if (!validCredentials(req.body)) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, underscores or hyphens; password must be 12–128 characters.' });
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
  app.post('/api/auth/logout', authenticate, asyncRoute(async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(req.cookies[cookieName])]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  }));
  app.get('/api/tasks', authenticate, asyncRoute(async (req, res) => {
    const result = await pool.query('SELECT id, title, description, status, priority, assignee, label, version FROM tasks ORDER BY id');
    res.json({ tasks: result.rows.map(taskFromRow) });
  }));
  app.post('/api/tasks', authenticate, asyncRoute(async (req, res) => {
    if (!validTask(req.body)) return res.status(400).json({ error: 'Invalid task details.' });
    const { title, description, status, priority, assignee, label } = req.body;
    const result = await pool.query('INSERT INTO tasks (title, description, status, priority, assignee, label) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [title.trim(), description.trim(), status, priority, assignee.trim(), label.trim()]);
    res.status(201).json({ task: taskFromRow(result.rows[0]) });
  }));
  app.put('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
    const id = taskId(req.params.id);
    if (!id || !validTask(req.body) || !Number.isSafeInteger(req.body.version) || req.body.version < 1) return res.status(400).json({ error: 'Invalid task details.' });
    const { title, description, status, priority, assignee, label, version } = req.body;
    const result = await pool.query('UPDATE tasks SET title=$1, description=$2, status=$3, priority=$4, assignee=$5, label=$6, version=version+1 WHERE id=$7 AND version=$8 RETURNING *', [title.trim(), description.trim(), status, priority, assignee.trim(), label.trim(), id, version]);
    if (!result.rowCount) return res.status(409).json({ error: 'This task was changed or deleted by someone else. Refresh and try again.' });
    res.json({ task: taskFromRow(result.rows[0]) });
  }));
  app.delete('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
    const id = taskId(req.params.id);
    if (!id || !Number.isSafeInteger(req.body?.version) || req.body.version < 1) return res.status(400).json({ error: 'Invalid task details.' });
    const result = await pool.query('DELETE FROM tasks WHERE id=$1 AND version=$2', [id, req.body.version]);
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
