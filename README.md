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

The startup migration preserves the existing board name and assigns all existing tasks to the original project. It also updates the task status constraint to allow backlog and In Review tasks. Back up the database before deploying schema changes. Use a persistent Render Postgres plan and configure backups appropriate to your needs.

## Accounts and data

Signup is **open to anyone who can reach the site**, and every account can view, create, edit, and delete every task. There is no account approval, password reset, or user administration yet; do not use this for sensitive information until access is restricted. Usernames are case-insensitive and 3–32 characters. New passwords must contain at least 8 characters, including ASCII letters and numbers. Passwords are hashed with scrypt; sessions use HTTP-only, same-site cookies and expire after seven days. The basic login/signup rate limit is per server instance and resets on restart.

Use the account menu in the top-right corner to change your username, password, or accent color. Username and password changes require your current password. Renaming updates matching task assignments; changing a password signs out your other sessions. Your color tints tickets assigned to you on the board and backlog; unassigned and legacy free-text assignments remain neutral. Team members see color changes on the next refresh.

Tasks and their status are shared through PostgreSQL. Workspace lists active projects with their progress; create projects there, or archive and restore them without deleting tasks. Each project has its own board and backlog. The board and project list refresh every 15 seconds, and concurrent edits are rejected rather than silently overwriting one another. On a conflict, close and reopen the task after the board refreshes before retrying. Existing browser-local tasks are not imported.

Use the Backlog tab to create and collect upcoming tasks. Select **Move to To do** when a task is ready for the board. To return a task to the backlog, edit it and change its status to Backlog. The board's task count and progress exclude backlog tasks.

Assign tasks from the searchable team-member dropdown on a board card or in the task editor. Select Unassigned to clear an assignment. Names entered before this dropdown was added remain visible until changed.

Double-click a ticket on the board or in the backlog to edit it. You can also select its title or use its edit button. Backlog rows show the assignee avatar, title, and actions; edit a ticket to see its other details.

Click the project name above its Board and Backlog tabs to rename it for everyone. Save with the button, Enter, or by clicking outside; Escape cancels. If someone else changes the name at the same time, review your draft and save again.

The board columns are To do, In progress, In Review, and Done. Drag a task to another column to change its status. On touchscreens, drag using the handle in the task's top-right corner. The arrow buttons provide an alternative for keyboard and touch users. Dragging does not reorder tasks within a column.
