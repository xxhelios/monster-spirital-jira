# Orbit

A lightweight starting point for a Jira-style task board, built with Vue 3, PrimeVue, TypeScript, and Webpack.

## Getting started

Requires Node.js 20.19+ or 22.12+ (a current LTS release is recommended).

```sh
npm install
npm run dev
```

Open the address printed by Webpack (normally `http://localhost:8080`). Run `npm run build` to type-check and create a production build in `dist`, or `npm run typecheck` to check types without building.

## Board

Create, edit, delete, search, filter, and move tasks between To do, In progress, and Done. The board starts with example tasks and saves changes in the browser's local storage. It is local to the current browser and device: there is no server, shared workspace, authentication, or synchronization yet. Clearing browser storage removes saved tasks.
