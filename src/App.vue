<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import AssigneeSelect from './AssigneeSelect.vue';
import { ApiError, request } from './api';
import { boardStatuses, priorities, statuses, type Priority, type Status, type Task, type TaskDetails } from './tasks';

const notice = ref('');
const username = ref('');
const authMode = ref<'login' | 'signup'>('login');
const credentials = reactive({ username: '', password: '' });
const authError = ref('');
const authBusy = ref(false);
const loading = ref(true);
const tasks = ref<Task[]>([]);
const users = ref<string[]>([]);
const usersError = ref('');
const usersLoading = ref(false);
let usersGeneration = 0;
const board = ref<{ title: string; version: number } | null>(null);
const boardLoadError = ref('');
const editingTitle = ref(false);
const titleDraft = ref('');
const titleError = ref('');
const titleSaving = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);
const titleEditVersion = ref<number | null>(null);
const titleOriginal = ref('');
let boardGeneration = 0;
const busy = ref(false);
const activeView = ref<'board' | 'backlog'>(window.location.hash === '#backlog' ? 'backlog' : 'board');
const draggedTask = ref<Task | null>(null);
const dropTarget = ref<Status | null>(null);
let touchStartPosition: { x: number; y: number } | null = null;
let touchPosition: { x: number; y: number } | null = null;
let touchScrollFrame: number | null = null;
let touchMoved = false;
let refreshGeneration = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function handleError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    username.value = '';
    tasks.value = [];
    users.value = [];
    usersError.value = '';
    ++usersGeneration;
    usersLoading.value = false;
    board.value = null;
    boardLoadError.value = '';
    editingTitle.value = false;
    dialogVisible.value = false;
    authError.value = error.message;
  } else {
    notice.value = message(error);
  }
}

async function refreshUsers() {
  const generation = ++usersGeneration;
  const currentUser = username.value;
  usersLoading.value = true;
  try {
    const result = await request<{ users: { username: string }[] }>('/users');
    if (generation === usersGeneration && currentUser && username.value === currentUser) {
      users.value = result.users.map((user) => user.username);
      usersError.value = '';
    }
  } catch (error) {
    if (generation === usersGeneration && username.value === currentUser) {
      if (error instanceof ApiError && error.status === 401) handleError(error);
      else usersError.value = message(error);
    }
  } finally {
    if (generation === usersGeneration) usersLoading.value = false;
  }
}

async function refreshTasks() {
  const generation = ++refreshGeneration;
  try {
    const result = await request<{ tasks: Task[] }>('/tasks');
    if (generation === refreshGeneration && username.value) {
      tasks.value = result.tasks;
      notice.value = '';
    }
  } catch (error) {
    if (generation === refreshGeneration) handleError(error);
  }
}

async function refreshBoard(force = false) {
  const generation = ++boardGeneration;
  const currentUser = username.value;
  try {
    const result = await request<{ board: { title: string; version: number } }>('/board');
    if (generation === boardGeneration && currentUser && username.value === currentUser && (force || !editingTitle.value)) {
      board.value = result.board;
      boardLoadError.value = '';
      return true;
    }
  } catch (error) {
    if (generation === boardGeneration && username.value === currentUser) {
      if (error instanceof ApiError && error.status === 401) handleError(error);
      else boardLoadError.value = message(error);
    }
  }
  return false;
}

async function editTitle() {
  if (!board.value || titleSaving.value) return;
  ++boardGeneration;
  titleDraft.value = board.value.title;
  titleOriginal.value = board.value.title;
  titleEditVersion.value = board.value.version;
  titleError.value = '';
  editingTitle.value = true;
  await nextTick();
  titleInput.value?.focus();
  titleInput.value?.select();
}

async function saveTitle() {
  if (!editingTitle.value || titleSaving.value || !board.value) return;
  const title = titleDraft.value.trim();
  if (!title) {
    titleError.value = 'Enter a board title.';
    return;
  }
  if (title === titleOriginal.value) {
    editingTitle.value = false;
    titleError.value = '';
    return;
  }
  titleSaving.value = true;
  titleError.value = '';
  const generation = ++boardGeneration;
  const currentUser = username.value;
  try {
    const result = await request<{ board: { title: string; version: number } }>('/board', {
      method: 'PUT', body: { title, version: titleEditVersion.value },
    });
    if (generation === boardGeneration && username.value === currentUser) {
      board.value = result.board;
      editingTitle.value = false;
    }
  } catch (error) {
    if (generation !== boardGeneration || username.value !== currentUser) return;
    if (error instanceof ApiError && error.status === 401) handleError(error);
    else {
      titleError.value = message(error);
      if (error instanceof ApiError && error.status === 409 && await refreshBoard(true) && board.value) {
        titleEditVersion.value = board.value.version;
        titleOriginal.value = board.value.title;
      }
    }
  } finally {
    titleSaving.value = false;
  }
}

function titleFocusOut(event: FocusEvent) {
  if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
  void saveTitle();
}

function cancelTitleEdit() {
  if (titleSaving.value) return;
  editingTitle.value = false;
  titleError.value = '';
}

async function authenticate() {
  authBusy.value = true;
  authError.value = '';
  try {
    const result = await request<{ user: { username: string } }>(`/auth/${authMode.value}`, { method: 'POST', body: credentials });
    username.value = result.user.username;
    credentials.password = '';
    await Promise.all([refreshTasks(), refreshBoard(), refreshUsers()]);
  } catch (error) {
    authError.value = message(error);
  } finally {
    authBusy.value = false;
  }
}

async function logout() {
  try {
    await request('/auth/logout', { method: 'POST', body: {} });
    ++refreshGeneration;
    ++boardGeneration;
    ++usersGeneration;
    username.value = '';
    tasks.value = [];
    users.value = [];
    usersError.value = '';
    usersLoading.value = false;
    board.value = null;
    boardLoadError.value = '';
    editingTitle.value = false;
    notice.value = '';
  } catch (error) {
    handleError(error);
  }
}

function syncView() {
  activeView.value = window.location.hash === '#backlog' ? 'backlog' : 'board';
  search.value = '';
  priorityFilter.value = 'All priorities';
  endDrag();
}

onMounted(async () => {
  window.addEventListener('hashchange', syncView);
  try {
    const result = await request<{ user: { username: string } }>('/auth/me');
    username.value = result.user.username;
    await Promise.all([refreshTasks(), refreshBoard(), refreshUsers()]);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) authError.value = message(error);
  } finally {
    loading.value = false;
  }
  refreshTimer = setInterval(() => {
    if (username.value && !busy.value && !draggedTask.value) void refreshTasks();
    if (username.value && !editingTitle.value && !titleSaving.value) void refreshBoard();
  }, 15000);
});
onUnmounted(() => {
  window.removeEventListener('hashchange', syncView);
  if (refreshTimer) clearInterval(refreshTimer);
  endDrag();
});

const search = ref('');
const priorityFilter = ref('All priorities');
const filteredTasks = computed(() => {
  const query = search.value.trim().toLowerCase();
  return tasks.value.filter((task) =>
    (priorityFilter.value === 'All priorities' || task.priority === priorityFilter.value) &&
    [task.title, task.description, task.id, task.assignee, task.label].some((value) => value.toLowerCase().includes(query)),
  );
});
const completed = computed(() => tasks.value.filter((task) => task.status === 'Done').length);
const boardTasks = computed(() => tasks.value.filter((task) => task.status !== 'Backlog'));
const backlogTasks = computed(() => filteredTasks.value.filter((task) => task.status === 'Backlog'));
const progress = computed(() => boardTasks.value.length ? Math.round(completed.value / boardTasks.value.length * 100) : 0);
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const editingVersion = ref<number | null>(null);
const formError = ref('');
const form = reactive<{ title: string; description: string; status: Status; priority: Priority; assignee: string; label: string }>({
  title: '', description: '', status: 'To do', priority: 'Medium', assignee: '', label: '',
});

function openTask(task?: Task, status: Status = 'To do') {
  editingId.value = task?.id ?? null;
  editingVersion.value = task?.version ?? null;
  Object.assign(form, task ?? { title: '', description: '', status, priority: 'Medium', assignee: '', label: '' });
  formError.value = '';
  dialogVisible.value = true;
  void refreshUsers();
}

async function saveTask() {
  const title = form.title.trim();
  if (!title) {
    formError.value = 'Give your task a title to continue.';
    return;
  }
  const details: TaskDetails = {
    title,
    description: form.description.trim(),
    status: form.status,
    priority: form.priority,
    assignee: form.assignee.trim(),
    label: form.label.trim(),
  };
  busy.value = true;
  ++refreshGeneration;
  try {
    if (editingId.value) {
      await request(`/tasks/${editingId.value}`, { method: 'PUT', body: { ...details, version: editingVersion.value } });
    } else {
      await request('/tasks', { method: 'POST', body: details });
    }
    dialogVisible.value = false;
    await refreshTasks();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) handleError(error);
    else formError.value = message(error);
  } finally {
    busy.value = false;
  }
}

async function deleteTask() {
  if (editingId.value && window.confirm('Delete this task? This cannot be undone.')) {
    busy.value = true;
    ++refreshGeneration;
    try {
      await request(`/tasks/${editingId.value}`, { method: 'DELETE', body: { version: editingVersion.value } });
      dialogVisible.value = false;
      await refreshTasks();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) handleError(error);
      else formError.value = message(error);
    } finally {
      busy.value = false;
    }
  }
}

async function moveTask(task: Task, direction: number) {
  const index = boardStatuses.findIndex((status) => status === task.status);
  const nextStatus = index === -1 ? undefined : boardStatuses[index + direction];
  if (nextStatus) await moveTaskToStatus(task, nextStatus);
}

async function moveTaskToStatus(task: Task, nextStatus: Status) {
  if (task.status === nextStatus) return;
  await updateTask(task, { status: nextStatus });
}

async function updateTask(task: Task, changes: Partial<Pick<Task, 'status' | 'assignee'>>) {
  if (busy.value) return;
  busy.value = true;
  ++refreshGeneration;
  try {
    await request(`/tasks/${task.id}`, { method: 'PUT', body: { ...task, ...changes } });
    await refreshTasks();
  } catch (error) {
    handleError(error);
  } finally {
    busy.value = false;
  }
}

function startDrag(task: Task, event: DragEvent) {
  if (busy.value || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  draggedTask.value = { ...task };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', task.id);
}

function endDrag() {
  if (touchScrollFrame !== null) cancelAnimationFrame(touchScrollFrame);
  touchScrollFrame = null;
  draggedTask.value = null;
  dropTarget.value = null;
  touchStartPosition = null;
  touchPosition = null;
  touchMoved = false;
}

function dragOver(status: Status, event: DragEvent) {
  if (!draggedTask.value || busy.value || draggedTask.value.status === status) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = status;
}

function dragLeave(status: Status, event: DragEvent) {
  const column = event.currentTarget;
  if (column instanceof HTMLElement && event.relatedTarget instanceof Node && column.contains(event.relatedTarget)) return;
  if (dropTarget.value === status) dropTarget.value = null;
}

function dropTask(status: Status, event: DragEvent) {
  if (!draggedTask.value) return;
  event.preventDefault();
  const task = draggedTask.value;
  endDrag();
  void moveTaskToStatus(task, status);
}

function startTouchDrag(task: Task, event: TouchEvent) {
  if (busy.value || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (!touch) return;
  draggedTask.value = { ...task };
  touchStartPosition = { x: touch.clientX, y: touch.clientY };
  touchMoved = false;
}

function moveTouchDrag(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch || !draggedTask.value || !touchStartPosition) return;
  if (Math.hypot(touch.clientX - touchStartPosition.x, touch.clientY - touchStartPosition.y) > 10) touchMoved = true;
  touchPosition = { x: touch.clientX, y: touch.clientY };
  updateTouchTarget();
  if (touchMoved && touchScrollFrame === null) touchScrollFrame = requestAnimationFrame(scrollDuringTouchDrag);
}

function updateTouchTarget() {
  if (!touchPosition || !draggedTask.value) return;
  const column = document.elementFromPoint(touchPosition.x, touchPosition.y)?.closest<HTMLElement>('[data-drop-status]');
  const status = statuses.find((item) => item === column?.dataset.dropStatus);
  dropTarget.value = touchMoved && status && status !== draggedTask.value.status ? status : null;
}

function scrollDuringTouchDrag() {
  touchScrollFrame = null;
  if (!touchPosition || !draggedTask.value || !touchMoved) return;
  const edge = 70;
  if (touchPosition.y < edge) window.scrollBy(0, -12);
  else if (touchPosition.y > window.innerHeight - edge) window.scrollBy(0, 12);
  updateTouchTarget();
  touchScrollFrame = requestAnimationFrame(scrollDuringTouchDrag);
}

function endTouchDrag() {
  const task = draggedTask.value;
  const status = dropTarget.value;
  endDrag();
  if (task && status) void moveTaskToStatus(task, status);
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function avatarClass(name: string) {
  const colors = ['peach', 'lavender', 'mint', 'blue'];
  return colors[Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length];
}
</script>

<template>
  <div v-if="loading" class="auth-page"><p>Loading your workspace...</p></div>
  <div v-else-if="!username" class="auth-page">
    <div class="auth-card">
      <div class="brand"><span class="brand-mark"><i class="pi pi-compass"></i></span><span>Monster Spirital Company<span class="brand-dot">.</span></span></div>
      <h1>{{ authMode === 'login' ? 'Welcome back.' : 'Join the workspace.' }}</h1>
      <p>{{ authMode === 'login' ? 'Sign in to see your team’s board.' : 'Create an account to start working together.' }}</p>
      <form class="task-form" @submit.prevent="authenticate">
        <label for="username">Username</label>
        <InputText id="username" v-model="credentials.username" autocomplete="username" required minlength="3" maxlength="32" />
        <label for="password">Password</label>
        <InputText id="password" v-model="credentials.password" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" required minlength="12" maxlength="128" />
        <small v-if="authMode === 'signup'">Use at least 12 characters. Usernames can contain letters, numbers, dots, underscores and hyphens.</small>
        <small v-if="authError" class="form-error" role="alert">{{ authError }}</small>
        <Button type="submit" :label="authMode === 'login' ? 'Sign in' : 'Create account'" :loading="authBusy" />
      </form>
      <button class="auth-switch" @click="authMode = authMode === 'login' ? 'signup' : 'login'; authError = ''">{{ authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Sign in' }}</button>
    </div>
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="Monster Spirital Company home">
        <span class="brand-mark"><i class="pi pi-compass"></i></span>
        <span>Monster Spirital Company<span class="brand-dot">.</span></span>
      </a>
      <div class="workspace-switcher">
        <div class="workspace-icon">M</div>
        <div class="workspace-text"><strong>Monster Spirital Company</strong><span>Workspace</span></div>
        <i class="pi pi-angle-down"></i>
      </div>
      <p class="nav-label">WORKSPACE</p>
      <nav aria-label="Workspace navigation">
        <a class="nav-link" :class="{ active: activeView === 'board' }" href="#board" :aria-current="activeView === 'board' ? 'page' : undefined"><i class="pi pi-th-large" aria-hidden="true"></i> Board <span v-if="activeView === 'board'" class="nav-indicator"></span></a>
        <a class="nav-link" :class="{ active: activeView === 'backlog' }" href="#backlog" :aria-current="activeView === 'backlog' ? 'page' : undefined"><i class="pi pi-list" aria-hidden="true"></i> Backlog <span v-if="activeView === 'backlog'" class="nav-indicator"></span></a>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <div class="note-icon"><i class="pi pi-sparkles"></i></div>
          <strong>A little progress<br>adds up.</strong>
          <p>Keep the momentum going, one task at a time.</p>
        </div>
        <div class="profile">
          <span class="avatar lavender">{{ initials(username) }}</span>
          <span><strong>{{ username }}</strong><small>My workspace</small></span>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="breadcrumb"><span>Workspace</span><i class="pi pi-angle-right"></i><strong>{{ activeView === 'board' ? board?.title : 'Backlog' }}</strong></div>
        <div class="topbar-right"><span class="topbar-label">{{ username }}</span><button class="logout-button" @click="logout">Sign out</button><span class="avatar lavender">{{ initials(username) }}</span></div>
      </header>
      <nav class="mobile-nav" aria-label="Workspace navigation">
        <a class="nav-link" :class="{ active: activeView === 'board' }" href="#board" :aria-current="activeView === 'board' ? 'page' : undefined"><i class="pi pi-th-large" aria-hidden="true"></i> Board</a>
        <a class="nav-link" :class="{ active: activeView === 'backlog' }" href="#backlog" :aria-current="activeView === 'backlog' ? 'page' : undefined"><i class="pi pi-list" aria-hidden="true"></i> Backlog</a>
      </nav>
      <div class="content" :id="activeView">
        <div v-if="notice" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> {{ notice }}</div>
        <div v-if="usersError" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> Could not load team members: {{ usersError }} <button class="auth-switch board-retry" @click="refreshUsers()">Retry</button></div>
        <div v-if="boardLoadError" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> Could not load the board title: {{ boardLoadError }} <button class="auth-switch board-retry" @click="refreshBoard()">Retry</button></div>
        <div class="page-heading">
          <div>
            <div class="eyebrow"><span class="eyebrow-dot"></span> YOUR WORKSPACE</div>
            <h1 v-if="activeView === 'backlog'">Backlog<span class="heading-dot">.</span></h1>
            <div v-else-if="board" class="board-title-area">
              <form v-if="editingTitle" class="board-title-editor" @submit.prevent="saveTitle" @focusout="titleFocusOut" @keydown.esc.prevent="cancelTitleEdit">
                <input ref="titleInput" v-model="titleDraft" aria-label="Board title" :aria-invalid="!!titleError" :aria-describedby="titleError ? 'board-title-error' : undefined" maxlength="120" :disabled="titleSaving">
                <button type="submit" class="title-save" :disabled="titleSaving">Save</button>
              </form>
              <h1 v-else><button class="board-title-button" type="button" :aria-label="`${board.title}, edit board title`" @click="editTitle">{{ board.title }}<span class="heading-dot">.</span> <i class="pi pi-pencil" aria-hidden="true"></i></button></h1>
              <small v-if="titleError" id="board-title-error" class="form-error" role="alert">{{ titleError }}</small>
            </div>
            <p>{{ activeView === 'board' ? 'Good things happen when great work comes together.' : 'Keep upcoming work here until it is ready for the board.' }}</p>
          </div>
          <Button label="Create task" icon="pi pi-plus" class="create-button" @click="openTask(undefined, activeView === 'backlog' ? 'Backlog' : 'To do')" />
        </div>

        <section v-if="activeView === 'board'" class="overview" aria-label="Project overview">
          <div class="overview-main">
            <div class="overview-icon"><i class="pi pi-bolt"></i></div>
            <div><span class="overview-kicker">THE BIG PICTURE</span><h2>Let's make it happen.</h2><p>A little clarity goes a long way. Here's where your work stands.</p></div>
          </div>
          <div class="overview-progress">
            <div class="progress-label"><span>Project progress</span><strong>{{ progress }}%</strong></div>
            <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" aria-label="Project progress"><div :style="{ width: `${progress}%` }"></div></div>
            <p>{{ completed }} of {{ boardTasks.length }} board tasks completed</p>
          </div>
        </section>

        <div class="board-header">
          <div><h2>{{ activeView === 'board' ? 'Board' : 'Backlog' }} <span class="task-total">{{ activeView === 'board' ? boardTasks.length : tasks.length - boardTasks.length }}</span></h2><p>{{ activeView === 'board' ? 'Drag tasks between columns, or use the arrow buttons to move them.' : 'Move tasks to To do when they are ready to work on.' }}</p></div>
          <div class="filters">
            <label class="search-box"><i class="pi pi-search"></i><span class="sr-only">Search tasks</span><input v-model="search" placeholder="Search tasks..." type="search"></label>
            <label class="filter-box"><i class="pi pi-sliders-h"></i><span class="sr-only">Filter by priority</span><select v-model="priorityFilter"><option>All priorities</option><option v-for="priority in priorities" :key="priority">{{ priority }}</option></select><i class="pi pi-angle-down"></i></label>
          </div>
        </div>

        <div v-if="activeView === 'board'" class="board">
          <section v-for="(status, columnIndex) in boardStatuses" :key="status" class="column" :class="{ 'column-drop-target': dropTarget === status }" :aria-label="status" :data-drop-status="status" @dragover="dragOver(status, $event)" @dragleave="dragLeave(status, $event)" @drop="dropTask(status, $event)">
            <div class="column-heading">
              <div><span class="status-dot" :class="`status-${columnIndex}`"></span><h3>{{ status }}</h3><span class="column-count">{{ filteredTasks.filter((task) => task.status === status).length }}</span></div>
              <button class="icon-button" :aria-label="`Add task to ${status}`" @click="openTask(undefined, status)"><i class="pi pi-plus"></i></button>
            </div>
            <div class="task-list">
              <article v-for="task in filteredTasks.filter((item) => item.status === status)" :key="task.id" class="task-card" :class="{ 'task-dragging': draggedTask?.id === task.id }" :draggable="!busy" @dragstart="startDrag(task, $event)" @dragend="endDrag">
                <div class="card-top"><span class="task-id">{{ task.id }}</span><div class="card-controls"><span class="drag-handle" aria-hidden="true" title="Drag to move" @touchstart.prevent="startTouchDrag(task, $event)" @touchmove.prevent="moveTouchDrag" @touchend.prevent="endTouchDrag" @touchcancel="endDrag"><i class="pi pi-bars"></i></span><button class="icon-button edit-button" :aria-label="`Edit ${task.title}`" @click="openTask(task)"><i class="pi pi-ellipsis-h"></i></button></div></div>
                <button class="task-title" @click="openTask(task)">{{ task.title }}</button>
                <p class="task-description">{{ task.description || 'No description yet.' }}</p>
                <div class="card-tags"><span v-if="task.label" class="tag category-tag">{{ task.label }}</span><span class="tag priority-tag" :class="`priority-${task.priority.toLowerCase()}`"><i class="pi pi-flag-fill"></i>{{ task.priority }}</span></div>
                <div class="card-footer">
                  <div class="assignee"><span class="avatar" :class="avatarClass(task.assignee)">{{ initials(task.assignee) }}</span><AssigneeSelect class="assignee-select" :model-value="task.assignee" :users="users" :label="`Assignee for ${task.title}`" :disabled="busy" :loading="usersLoading" @refresh="refreshUsers" @update:model-value="updateTask(task, { assignee: $event })" /></div>
                  <div class="move-actions"><button v-if="columnIndex > 0" class="icon-button" :disabled="busy" :aria-label="`Move ${task.title} to ${boardStatuses[columnIndex - 1]}`" @click="moveTask(task, -1)"><i class="pi pi-arrow-left"></i></button><button v-if="columnIndex < boardStatuses.length - 1" class="icon-button" :disabled="busy" :aria-label="`Move ${task.title} to ${boardStatuses[columnIndex + 1]}`" @click="moveTask(task, 1)"><i class="pi pi-arrow-right"></i></button></div>
                </div>
              </article>
              <div v-if="!filteredTasks.some((task) => task.status === status)" class="empty-column">No tasks here yet.</div>
              <button class="add-card" @click="openTask(undefined, status)"><i class="pi pi-plus"></i> Add a task</button>
            </div>
          </section>
        </div>
        <section v-else class="backlog-list" aria-label="Backlog tasks">
          <article v-for="task in backlogTasks" :key="task.id" class="backlog-item">
            <div class="backlog-details">
              <span class="task-id">{{ task.id }}</span>
              <button class="task-title" @click="openTask(task)">{{ task.title }}</button>
              <p class="task-description">{{ task.description || 'No description yet.' }}</p>
              <div class="card-tags"><span v-if="task.label" class="tag category-tag">{{ task.label }}</span><span class="tag priority-tag" :class="`priority-${task.priority.toLowerCase()}`"><i class="pi pi-flag-fill"></i>{{ task.priority }}</span><AssigneeSelect class="assignee-select" :model-value="task.assignee" :users="users" :label="`Assignee for ${task.title}`" :disabled="busy" :loading="usersLoading" @refresh="refreshUsers" @update:model-value="updateTask(task, { assignee: $event })" /></div>
            </div>
            <Button label="Move to To do" icon="pi pi-arrow-right" :disabled="busy" :aria-label="`Move ${task.title} to To do`" @click="moveTaskToStatus(task, 'To do')" />
          </article>
          <div v-if="!backlogTasks.length" class="empty-column">{{ search || priorityFilter !== 'All priorities' ? 'No matching backlog tasks.' : 'Your backlog is empty. Create a task to get started.' }}</div>
        </section>
        <footer class="footer"><span>Made for making progress <span class="footer-heart">♥</span></span><span>One task at a time.</span></footer>
      </div>
    </main>

    <Dialog v-model:visible="dialogVisible" modal :header="editingId ? 'Edit task' : 'Create a task'" :style="{ width: 'min(94vw, 520px)' }">
      <form class="task-form" @submit.prevent="saveTask">
        <label for="task-title">Title <span class="required">*</span></label>
        <InputText id="task-title" v-model="form.title" autofocus placeholder="What needs to be done?" maxlength="120" :aria-invalid="!!formError" />
        <small v-if="formError" class="form-error" role="alert">{{ formError }}</small>
        <label for="task-description">Description</label>
        <Textarea id="task-description" v-model="form.description" rows="3" placeholder="Add a little more detail..." maxlength="1000" />
        <div class="form-grid">
          <div><label id="status-label" for="task-status">Status</label><Select input-id="task-status" aria-labelledby="status-label" v-model="form.status" :options="[...statuses]" /></div>
          <div><label id="priority-label" for="task-priority">Priority</label><Select input-id="task-priority" aria-labelledby="priority-label" v-model="form.priority" :options="[...priorities]" /></div>
          <div><label id="assignee-label" for="task-assignee">Assignee</label><AssigneeSelect input-id="task-assignee" labelledby="assignee-label" label="Assignee" v-model="form.assignee" :users="users" :loading="usersLoading" @refresh="refreshUsers" /><small v-if="usersError" class="form-error" role="alert">Could not load team members: {{ usersError }} <button type="button" class="auth-switch board-retry" @click="refreshUsers()">Retry</button></small></div>
          <div><label for="task-label">Label</label><InputText id="task-label" v-model="form.label" placeholder="e.g. Design" maxlength="40" /></div>
        </div>
        <div class="dialog-actions">
          <Button v-if="editingId" type="button" label="Delete" severity="danger" text :disabled="busy" @click="deleteTask" />
          <span class="actions-spacer"></span>
          <Button type="button" label="Cancel" severity="secondary" text @click="dialogVisible = false" />
          <Button type="submit" :label="editingId ? 'Save changes' : 'Create task'" :loading="busy" />
        </div>
      </form>
    </Dialog>
  </div>
</template>
