# Monster Spirital Company

A shared task board built with Vue, PrimeVue, TypeScript, a Node.js API, and PostgreSQL.

## Local development

Requires Node.js 22.12+ (a current LTS release is recommended) and a PostgreSQL database. Set `DATABASE_URL` to a PostgreSQL connection string in your shell; do not commit credentials.

```sh
npm ci
npm run migrate
npm start
```

In another terminal, run `npm run dev`, then open `http://localhost:8080`. Webpack proxies API requests to the Node server at port 3000. Alternatively, run `npm run build` and open `http://localhost:3000` to use the production build served by Node.

Run `npm test` for API integration tests and `npm run build` for type-checking and a production build.

## Deploy on Render

1. Create a Render Postgres database and a **Node Web Service** in the same region.
2. Set the Web Service's `DATABASE_URL` environment variable to the database's internal connection URL. Set `NODE_ENV` to `production` so session cookies are secure.
3. Use build command `npm ci --include=dev && npm run build` and start command `npm run migrate && npm start`. Including development dependencies is required for Webpack and TypeScript when `NODE_ENV=production`.
4. Open the service's HTTPS URL and create accounts. The Web Service serves both the frontend and API; a separate static site is not required.

The startup migration preserves existing tasks and updates the task status constraint to allow backlog tasks. Use a persistent Render Postgres plan and configure backups appropriate to your needs.

## Accounts and data

Signup is **open to anyone who can reach the site**, and every account can view, create, edit, and delete every task. There is no account approval, password reset, or user administration yet; do not use this for sensitive information until access is restricted. Usernames are case-insensitive, 3–32 characters, and passwords must contain 12–128 characters. Passwords are hashed with scrypt; sessions use HTTP-only, same-site cookies and expire after seven days. The basic login/signup rate limit is per server instance and resets on restart.

Tasks and their status are shared through PostgreSQL. The board refreshes every 15 seconds, and concurrent edits are rejected rather than silently overwriting one another. On a conflict, close and reopen the task after the board refreshes before retrying. Existing browser-local tasks are not imported; the new shared board starts empty.

Use the Backlog tab to create and collect upcoming tasks. Select **Move to To do** when a task is ready for the board. To return a task to the backlog, edit it and change its status to Backlog. The board's task count and progress exclude backlog tasks.

Click the board title to rename it for everyone. Save with the button, Enter, or by clicking outside; Escape cancels. If someone else changes the name at the same time, review your draft and save again.

Drag a task to another column to change its status. On touchscreens, drag using the handle in the task's top-right corner. The arrow buttons provide an alternative for keyboard and touch users. Dragging does not reorder tasks within a column.
