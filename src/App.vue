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
const accountMenuOpen = ref(false);
const accountMenu = ref<HTMLElement | null>(null);
const accountMenuButton = ref<HTMLButtonElement | null>(null);
const accentColors = ['peach', 'lavender', 'mint', 'blue', 'rose', 'gold'] as const;
type AccentColor = (typeof accentColors)[number];
type User = { username: string; accent_color: AccentColor | null };
const accountDialog = ref<'username' | 'password' | 'color' | null>(null);
const accountForm = reactive<{ username: string; currentPassword: string; newPassword: string; confirmPassword: string; color: AccentColor }>({ username: '', currentPassword: '', newPassword: '', confirmPassword: '', color: 'lavender' });
const accountError = ref('');
const accountBusy = ref(false);
const loading = ref(true);
const tasks = ref<Task[]>([]);
const users = ref<User[]>([]);
const userNames = computed(() => users.value.map((user) => user.username));
const usersError = ref('');
const usersLoading = ref(false);
let usersGeneration = 0;
type Project = { id: string; title: string; version: number; archived: boolean; total: number; completed: number };
const projects = ref<Project[]>([]);
const projectId = ref<string | null>(null);
const board = computed(() => projects.value.find((project) => project.id === projectId.value && !project.archived) ?? null);
const activeProjects = computed(() => projects.value.filter((project) => !project.archived));
const archivedProjects = computed(() => projects.value.filter((project) => project.archived));
const newProjectTitle = ref('');
const projectError = ref('');
const projectBusy = ref(false);
const boardLoadError = ref('');
const editingTitle = ref(false);
const titleDraft = ref('');
const titleError = ref('');
const titleSaving = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);
const mobileTitleInput = ref<HTMLInputElement | null>(null);
const titleEditVersion = ref<number | null>(null);
const titleOriginal = ref('');
let boardGeneration = 0;
const busy = ref(false);
const activeView = ref<'workspace' | 'board' | 'backlog'>('workspace');
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
    projects.value = [];
    boardLoadError.value = '';
    editingTitle.value = false;
    dialogVisible.value = false;
    accountDialog.value = null;
    accountMenuOpen.value = false;
    clearAccountForm();
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
    const result = await request<{ users: User[] }>('/users');
    if (generation === usersGeneration && currentUser && username.value === currentUser) {
      users.value = result.users;
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
  const currentProject = projectId.value;
  if (!currentProject || activeView.value === 'workspace') return;
  const generation = ++refreshGeneration;
  try {
    const result = await request<{ tasks: Task[] }>(`/projects/${encodeURIComponent(currentProject)}/tasks`);
    if (generation === refreshGeneration && username.value && projectId.value === currentProject) {
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
    const result = await request<{ projects: Project[] }>('/projects');
    if (generation === boardGeneration && currentUser && username.value === currentUser && (force || !editingTitle.value)) {
      projects.value = result.projects;
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
  const input = titleInput.value?.getClientRects().length ? titleInput.value : mobileTitleInput.value;
  input?.focus();
  input?.select();
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
  const currentProject = board.value;
  try {
    await request(`/projects/${encodeURIComponent(currentProject.id)}`, {
      method: 'PATCH', body: { title, archived: false, version: titleEditVersion.value },
    });
    if (username.value === currentUser) {
      if (projectId.value === currentProject.id) editingTitle.value = false;
      await refreshBoard();
    }
  } catch (error) {
    if (username.value !== currentUser) return;
    if (error instanceof ApiError && error.status === 401) handleError(error);
    else if (projectId.value !== currentProject.id || !editingTitle.value) handleError(error);
    else if (generation !== boardGeneration) handleError(error);
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

function clearAccountForm() {
  accountForm.username = '';
  accountForm.currentPassword = '';
  accountForm.newPassword = '';
  accountForm.confirmPassword = '';
  accountError.value = '';
}

function openAccountDialog(kind: 'username' | 'password' | 'color') {
  accountMenuOpen.value = false;
  clearAccountForm();
  accountForm.username = username.value;
  accountForm.color = avatarClass(username.value);
  accountDialog.value = kind;
}

async function saveAccount() {
  if (!accountDialog.value || accountBusy.value) return;
  if (accountDialog.value === 'password' && accountForm.newPassword !== accountForm.confirmPassword) {
    accountError.value = 'New passwords do not match.';
    return;
  }
  accountBusy.value = true;
  accountError.value = '';
  if (accountDialog.value === 'color') {
    try {
      const result = await request<{ user: User }>('/auth/color', { method: 'PATCH', body: { color: accountForm.color } });
      ++usersGeneration;
      users.value = [...users.value.filter((user) => user.username !== result.user.username), result.user];
      accountDialog.value = null;
      clearAccountForm();
      await refreshUsers();
      if (username.value) notice.value = 'Accent color updated successfully.';
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) handleError(error);
      else accountError.value = message(error);
    } finally {
      accountBusy.value = false;
    }
    return;
  }
  const body = accountDialog.value === 'username'
    ? { username: accountForm.username, currentPassword: accountForm.currentPassword }
    : { newPassword: accountForm.newPassword, currentPassword: accountForm.currentPassword };
  try {
    const result = await request<{ user: { username: string } }>('/auth/account', { method: 'PATCH', body });
    username.value = result.user.username;
    accountDialog.value = null;
    clearAccountForm();
    await Promise.all([refreshUsers(), refreshTasks(), refreshBoard()]);
    if (username.value) notice.value = 'Account updated successfully.';
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) handleError(error);
    else accountError.value = message(error);
  } finally {
    accountBusy.value = false;
  }
}

function closeAccountMenu(event: PointerEvent) {
  if (event.target instanceof Node && !accountMenu.value?.contains(event.target)) accountMenuOpen.value = false;
}

function accountMenuEscape() {
  accountMenuOpen.value = false;
  accountMenuButton.value?.focus();
}

function accountMenuFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !accountMenu.value?.contains(event.relatedTarget)) accountMenuOpen.value = false;
}

async function logout() {
  try {
    await request('/auth/logout', { method: 'POST', body: {} });
    ++refreshGeneration;
    ++boardGeneration;
    ++usersGeneration;
    username.value = '';
    tasks.value = [];
    dialogVisible.value = false;
    users.value = [];
    usersError.value = '';
    usersLoading.value = false;
    projects.value = [];
    boardLoadError.value = '';
    editingTitle.value = false;
    accountMenuOpen.value = false;
    accountDialog.value = null;
    clearAccountForm();
    notice.value = '';
  } catch (error) {
    handleError(error);
  }
}

function syncView() {
  const hash = window.location.hash;
  const match = /^#project\/([a-zA-Z0-9-]+)\/(board|backlog)$/.exec(hash);
  projectId.value = match ? match[1] : hash === '#board' || hash === '#backlog' ? 'default' : null;
  activeView.value = match ? (match[2] === 'backlog' ? 'backlog' : 'board') : hash === '#board' ? 'board' : hash === '#backlog' ? 'backlog' : 'workspace';
  ++refreshGeneration;
  tasks.value = [];
  search.value = '';
  priorityFilter.value = 'All priorities';
  endDrag();
  editingTitle.value = false;
  if (username.value) void refreshBoard();
  if (username.value && projectId.value) void refreshTasks();
}

onMounted(async () => {
  window.addEventListener('hashchange', syncView);
  document.addEventListener('pointerdown', closeAccountMenu);
  syncView();
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
    if (username.value && projectId.value && !busy.value && !draggedTask.value) void refreshTasks();
    if (username.value && !editingTitle.value && !titleSaving.value) void refreshBoard();
    if (username.value && !usersLoading.value) void refreshUsers();
  }, 15000);
});
onUnmounted(() => {
  window.removeEventListener('hashchange', syncView);
  document.removeEventListener('pointerdown', closeAccountMenu);
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
const boardTasks = computed(() => tasks.value.filter((task) => task.status !== 'Backlog'));
const backlogTasks = computed(() => filteredTasks.value.filter((task) => task.status === 'Backlog'));
const projectUrl = (id: string, view: 'board' | 'backlog') => `#project/${id}/${view}`;
const projectProgress = (project: Project) => project.total ? Math.round(project.completed / project.total * 100) : 0;

async function createProject() {
  const title = newProjectTitle.value.trim();
  if (!title) {
    projectError.value = 'Enter a project name.';
    return;
  }
  projectBusy.value = true;
  projectError.value = '';
  try {
    const result = await request<{ project: Project }>('/projects', { method: 'POST', body: { title } });
    newProjectTitle.value = '';
    await refreshBoard();
    window.location.hash = projectUrl(result.project.id, 'board');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) handleError(error);
    else projectError.value = message(error);
  } finally {
    projectBusy.value = false;
  }
}

async function setArchived(project: Project, archived: boolean) {
  if (archived && !window.confirm(`Archive "${project.title}"? Its tasks will be preserved.`)) return;
  projectBusy.value = true;
  projectError.value = '';
  try {
    await request(`/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: { title: project.title, version: project.version, archived } });
    await refreshBoard();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) handleError(error);
    else projectError.value = message(error);
    if (error instanceof ApiError && error.status === 409) await refreshBoard();
  } finally {
    projectBusy.value = false;
  }
}
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

function doubleClickTask(task: Task, event: MouseEvent) {
  if (busy.value || dialogVisible.value || draggedTask.value) return;
  if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [role="button"], [role="combobox"], .drag-handle')) return;
  openTask(task);
}

async function saveTask() {
  if (!projectId.value) return;
  const projectPath = `/projects/${encodeURIComponent(projectId.value)}/tasks`;
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
      await request(`${projectPath}/${editingId.value}`, { method: 'PUT', body: { ...details, version: editingVersion.value } });
    } else {
      await request(projectPath, { method: 'POST', body: details });
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
  if (editingId.value && projectId.value && window.confirm('Delete this task? This cannot be undone.')) {
    busy.value = true;
    ++refreshGeneration;
    try {
      await request(`/projects/${encodeURIComponent(projectId.value)}/tasks/${editingId.value}`, { method: 'DELETE', body: { version: editingVersion.value } });
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

async function moveTaskToStatus(task: Task, nextStatus: Status) {
  if (task.status === nextStatus) return;
  await updateTask(task, { status: nextStatus });
}

async function updateTask(task: Task, changes: Partial<Pick<Task, 'status' | 'assignee'>>) {
  if (busy.value || !projectId.value) return;
  busy.value = true;
  ++refreshGeneration;
  try {
    await request(`/projects/${encodeURIComponent(projectId.value)}/tasks/${task.id}`, { method: 'PUT', body: { ...task, ...changes } });
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
  const user = users.value.find((member) => member.username === name);
  return user?.accent_color ?? accentColors[Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4];
}

function ticketColor(name: string) {
  return name && users.value.some((user) => user.username === name) ? `ticket-${avatarClass(name)}` : '';
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
        <InputText id="password" v-model="credentials.password" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" required :minlength="authMode === 'signup' ? 8 : undefined" :pattern="authMode === 'signup' ? '(?=[\\s\\S]*[a-zA-Z])(?=[\\s\\S]*[0-9])[\\s\\S]{8,}' : undefined" :title="authMode === 'signup' ? 'Use at least 8 characters, including letters and numbers.' : undefined" />
        <small v-if="authMode === 'signup'">Use at least 8 characters, including letters and numbers. Usernames can contain letters, numbers, dots, underscores and hyphens.</small>
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
      <p class="nav-label">WORKSPACE</p>
      <nav aria-label="Workspace navigation">
        <a class="nav-link" :class="{ active: activeView === 'workspace' }" href="#workspace" :aria-current="activeView === 'workspace' ? 'page' : undefined"><i class="pi pi-home" aria-hidden="true"></i> Workspace</a>
        <template v-if="board && activeView !== 'workspace'">
          <div class="project-sidebar-title">
            <form v-if="editingTitle" class="project-title-editor" @submit.prevent="saveTitle" @focusout="titleFocusOut" @keydown.esc.prevent="cancelTitleEdit">
              <input ref="mobileTitleInput" v-model="titleDraft" aria-label="Project title" :aria-invalid="!!titleError" maxlength="120" :disabled="titleSaving">
              <button type="submit" class="title-save" :disabled="titleSaving">Save</button>
            </form>
            <button v-else class="project-title-button" type="button" :aria-label="`${board.title}, edit project title`" @click="editTitle">{{ board.title }} <i class="pi pi-pencil" aria-hidden="true"></i></button>
            <small v-if="titleError" class="form-error" role="alert">{{ titleError }}</small>
          </div>
          <a class="nav-link" :class="{ active: activeView === 'board' }" :href="projectUrl(board.id, 'board')" :aria-current="activeView === 'board' ? 'page' : undefined"><i class="pi pi-th-large" aria-hidden="true"></i> Board</a>
          <a class="nav-link" :class="{ active: activeView === 'backlog' }" :href="projectUrl(board.id, 'backlog')" :aria-current="activeView === 'backlog' ? 'page' : undefined"><i class="pi pi-list" aria-hidden="true"></i> Backlog</a>
        </template>
      </nav>
      <div class="sidebar-bottom">
        <div class="profile">
          <span class="avatar" :class="avatarClass(username)">{{ initials(username) }}</span>
          <span><strong>{{ username }}</strong><small>My workspace</small></span>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="breadcrumb"><a href="#workspace">Workspace</a><template v-if="activeView !== 'workspace' && board"><i class="pi pi-angle-right"></i><strong>{{ activeView === 'board' ? 'Board' : 'Backlog' }}</strong></template></div>
        <div ref="accountMenu" class="topbar-right account-menu" @keydown.esc.stop.prevent="accountMenuEscape" @focusout="accountMenuFocusOut">
          <button ref="accountMenuButton" class="account-trigger" type="button" aria-controls="account-menu" :aria-expanded="accountMenuOpen" aria-label="Account menu" @click="accountMenuOpen = !accountMenuOpen">
            <span class="topbar-label">{{ username }}</span><span class="avatar" :class="avatarClass(username)">{{ initials(username) }}</span><i class="pi pi-angle-down" aria-hidden="true"></i>
          </button>
          <div v-if="accountMenuOpen" id="account-menu" class="account-dropdown">
            <button type="button" @click="openAccountDialog('username')">Change username</button>
            <button type="button" @click="openAccountDialog('password')">Change password</button>
            <button type="button" @click="openAccountDialog('color')">Change accent color</button>
            <button type="button" @click="logout">Sign out</button>
          </div>
        </div>
      </header>
      <nav class="mobile-nav" aria-label="Workspace navigation">
        <a class="nav-link" :class="{ active: activeView === 'workspace' }" href="#workspace" :aria-current="activeView === 'workspace' ? 'page' : undefined"><i class="pi pi-home" aria-hidden="true"></i> Workspace</a>
      </nav>
      <div v-if="board && activeView !== 'workspace'" class="mobile-project-title">
        <form v-if="editingTitle" class="project-title-editor" @submit.prevent="saveTitle" @focusout="titleFocusOut" @keydown.esc.prevent="cancelTitleEdit">
          <input ref="titleInput" v-model="titleDraft" aria-label="Project title" :aria-invalid="!!titleError" maxlength="120" :disabled="titleSaving">
          <button type="submit" class="title-save" :disabled="titleSaving">Save</button>
        </form>
        <button v-else class="project-title-button" type="button" :aria-label="`${board.title}, edit project title`" @click="editTitle">{{ board.title }} <i class="pi pi-pencil" aria-hidden="true"></i></button>
        <small v-if="titleError" class="form-error" role="alert">{{ titleError }}</small>
      </div>
      <nav v-if="board && activeView !== 'workspace'" class="mobile-nav mobile-project-nav" aria-label="Project navigation">
        <a class="nav-link" :class="{ active: activeView === 'board' }" :href="projectUrl(board.id, 'board')" :aria-current="activeView === 'board' ? 'page' : undefined">Board</a>
        <a class="nav-link" :class="{ active: activeView === 'backlog' }" :href="projectUrl(board.id, 'backlog')" :aria-current="activeView === 'backlog' ? 'page' : undefined">Backlog</a>
      </nav>
      <div class="content" :class="{ 'project-content': activeView !== 'workspace' }" :id="activeView">
        <div v-if="notice" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> {{ notice }}</div>
        <div v-if="usersError" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> Could not load team members: {{ usersError }} <button class="auth-switch board-retry" @click="refreshUsers()">Retry</button></div>
        <div v-if="boardLoadError" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> Could not load projects: {{ boardLoadError }} <button class="auth-switch board-retry" @click="refreshBoard()">Retry</button></div>
        <template v-if="activeView === 'workspace'">
          <div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> YOUR WORKSPACE</div><h1>Projects<span class="heading-dot">.</span></h1><p>Your team's active work, all in one place.</p></div></div>
          <form class="project-create" @submit.prevent="createProject">
            <label for="new-project">New project</label>
            <div><InputText id="new-project" v-model="newProjectTitle" placeholder="Project name" maxlength="120" /><Button type="submit" label="Create project" icon="pi pi-plus" :loading="projectBusy" /></div>
            <small v-if="projectError" class="form-error" role="alert">{{ projectError }}</small>
          </form>
          <h2 class="projects-heading">Active projects <span class="task-total">{{ activeProjects.length }}</span></h2>
          <div class="projects-grid">
            <article v-for="project in activeProjects" :key="project.id" class="project-card">
              <a :href="projectUrl(project.id, 'board')" class="project-card-title">{{ project.title }} <i class="pi pi-arrow-right" aria-hidden="true"></i></a>
              <div class="progress-label"><span>Project progress</span><strong>{{ projectProgress(project) }}%</strong></div>
              <div class="progress-track" role="progressbar" :aria-label="`${project.title} progress`" :aria-valuenow="projectProgress(project)" aria-valuemin="0" aria-valuemax="100"><div :style="{ width: `${projectProgress(project)}%` }"></div></div>
              <p>{{ project.completed }} of {{ project.total }} board tasks completed</p>
              <button class="project-archive" :disabled="projectBusy" @click="setArchived(project, true)">Archive</button>
            </article>
            <p v-if="!activeProjects.length && !boardLoadError" class="empty-column">No active projects yet.</p>
          </div>
          <section v-if="archivedProjects.length" class="archived-projects"><h2 class="projects-heading">Archived projects</h2><div v-for="project in archivedProjects" :key="project.id" class="archived-project"><strong>{{ project.title }}</strong><button class="project-archive" :disabled="projectBusy" @click="setArchived(project, false)">Restore</button></div></section>
        </template>
        <template v-else-if="board">

        <div class="board-header">
          <div><h2>{{ activeView === 'board' ? 'Board' : 'Backlog' }} <span class="task-total">{{ activeView === 'board' ? boardTasks.length : tasks.length - boardTasks.length }}</span></h2><p>{{ activeView === 'board' ? 'Drag tasks between columns, or edit their status to move them.' : 'Move tasks to To do when they are ready to work on.' }}</p></div>
          <div class="filters">
            <label class="search-box"><i class="pi pi-search"></i><span class="sr-only">Search tasks</span><input v-model="search" placeholder="Search tasks..." type="search"></label>
            <label class="filter-box"><i class="pi pi-sliders-h"></i><span class="sr-only">Filter by priority</span><select v-model="priorityFilter"><option>All priorities</option><option v-for="priority in priorities" :key="priority">{{ priority }}</option></select><i class="pi pi-angle-down"></i></label>
            <Button label="Create task" icon="pi pi-plus" class="create-button" @click="openTask(undefined, activeView === 'backlog' ? 'Backlog' : 'To do')" />
          </div>
        </div>

        <div v-if="activeView === 'board'" class="board">
          <section v-for="(status, columnIndex) in boardStatuses" :key="status" class="column" :class="{ 'column-drop-target': dropTarget === status }" :aria-label="status" :data-drop-status="status" @dragover="dragOver(status, $event)" @dragleave="dragLeave(status, $event)" @drop="dropTask(status, $event)">
            <div class="column-heading">
              <div><span class="status-dot" :class="`status-${columnIndex}`"></span><h3>{{ status }}</h3><span class="column-count">{{ filteredTasks.filter((task) => task.status === status).length }}</span></div>
              <button class="icon-button" :aria-label="`Add task to ${status}`" @click="openTask(undefined, status)"><i class="pi pi-plus"></i></button>
            </div>
            <div class="task-list">
              <article v-for="task in filteredTasks.filter((item) => item.status === status)" :key="task.id" class="task-card" :class="[ticketColor(task.assignee), { 'task-dragging': draggedTask?.id === task.id }]" :draggable="!busy" @dblclick="doubleClickTask(task, $event)" @dragstart="startDrag(task, $event)" @dragend="endDrag">
                <div class="card-top"><span class="task-id">{{ task.id }}</span><div class="card-controls"><span class="drag-handle" aria-hidden="true" title="Drag to move" @touchstart.prevent="startTouchDrag(task, $event)" @touchmove.prevent="moveTouchDrag" @touchend.prevent="endTouchDrag" @touchcancel="endDrag"><i class="pi pi-bars"></i></span><button class="icon-button edit-button" :aria-label="`Edit ${task.title}`" @click="openTask(task)"><i class="pi pi-ellipsis-h"></i></button></div></div>
                <button class="task-title" @click="openTask(task)">{{ task.title }}</button>
                <p class="task-description">{{ task.description || 'No description yet.' }}</p>
                <div class="card-tags"><span v-if="task.label" class="tag category-tag">{{ task.label }}</span><span class="tag priority-tag" :class="`priority-${task.priority.toLowerCase()}`"><i class="pi pi-flag-fill"></i>{{ task.priority }}</span></div>
                <div class="card-footer">
                  <span class="avatar" :class="avatarClass(task.assignee)" role="img" :aria-label="task.assignee ? `Assigned to ${task.assignee}` : 'Unassigned'" :title="task.assignee || 'Unassigned'">{{ initials(task.assignee) }}</span>
                </div>
              </article>
              <div v-if="!filteredTasks.some((task) => task.status === status)" class="empty-column">No tasks here yet.</div>
              <button class="add-card" @click="openTask(undefined, status)"><i class="pi pi-plus"></i> Add a task</button>
            </div>
          </section>
        </div>
        <section v-else class="backlog-list" aria-label="Backlog tasks">
          <article v-for="task in backlogTasks" :key="task.id" class="backlog-item" :class="ticketColor(task.assignee)" @dblclick="doubleClickTask(task, $event)">
            <div class="backlog-title">
              <span class="task-id">{{ task.id }}</span>
              <span class="avatar" :class="avatarClass(task.assignee)" role="img" :aria-label="task.assignee ? `Assigned to ${task.assignee}` : 'Unassigned'" :title="task.assignee || 'Unassigned'">{{ initials(task.assignee) }}</span>
              <button class="task-title" @click="openTask(task)">{{ task.title }}</button>
            </div>
            <div class="backlog-actions">
              <Button label="Edit" icon="pi pi-pencil" severity="secondary" text :disabled="busy" :aria-label="`Edit ${task.title}`" @click="openTask(task)" />
              <Button label="Move to To do" icon="pi pi-arrow-right" :disabled="busy" :aria-label="`Move ${task.title} to To do`" @click="moveTaskToStatus(task, 'To do')" />
            </div>
          </article>
          <div v-if="!backlogTasks.length" class="empty-column">{{ search || priorityFilter !== 'All priorities' ? 'No matching backlog tasks.' : 'Your backlog is empty. Create a task to get started.' }}</div>
        </section>
        </template>
        <p v-else-if="!boardLoadError" class="empty-column">Project not found or archived. Return to Workspace to select an active project.</p>
        <footer class="footer"><span>Made for making progress <span class="footer-heart">♥</span></span><span>One task at a time.</span></footer>
      </div>
    </main>

    <Dialog :visible="accountDialog !== null" modal :header="accountDialog === 'username' ? 'Change username' : accountDialog === 'password' ? 'Change password' : 'Change accent color'" :style="{ width: 'min(94vw, 440px)' }" :closable="!accountBusy" :close-on-escape="!accountBusy" @update:visible="!$event && (accountDialog = null)" @hide="clearAccountForm">
      <form class="task-form" @submit.prevent="saveAccount">
        <template v-if="accountDialog === 'username'">
          <label for="account-username">New username</label>
          <InputText id="account-username" v-model="accountForm.username" autocomplete="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}" title="Use 3–32 letters, numbers, dots, underscores or hyphens, starting with a letter or number." />
        </template>
        <template v-else-if="accountDialog === 'password'">
          <label for="account-new-password">New password</label>
          <InputText id="account-new-password" v-model="accountForm.newPassword" type="password" autocomplete="new-password" required minlength="8" pattern="(?=[\s\S]*[a-zA-Z])(?=[\s\S]*[0-9])[\s\S]{8,}" title="Use at least 8 characters, including letters and numbers." />
          <small>Use at least 8 characters, including letters and numbers.</small>
          <label for="account-confirm-password">Confirm new password</label>
          <InputText id="account-confirm-password" v-model="accountForm.confirmPassword" type="password" autocomplete="new-password" required />
        </template>
        <fieldset v-else class="color-options">
          <legend>Choose your accent color</legend>
          <label v-for="color in accentColors" :key="color" class="color-option">
            <input v-model="accountForm.color" type="radio" name="accent-color" :value="color">
            <span class="color-swatch" :class="color" aria-hidden="true"></span>
            <span class="color-name">{{ color }}</span>
          </label>
        </fieldset>
        <template v-if="accountDialog !== 'color'">
          <label for="account-current-password">Current password</label>
          <InputText id="account-current-password" v-model="accountForm.currentPassword" type="password" autocomplete="current-password" required />
        </template>
        <small v-if="accountError" class="form-error" role="alert">{{ accountError }}</small>
        <div class="dialog-actions">
          <span class="actions-spacer"></span>
          <Button type="button" label="Cancel" severity="secondary" text :disabled="accountBusy" @click="accountDialog = null" />
          <Button type="submit" label="Save changes" :loading="accountBusy" />
        </div>
      </form>
    </Dialog>

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
          <div><label id="assignee-label" for="task-assignee">Assignee</label><AssigneeSelect input-id="task-assignee" labelledby="assignee-label" label="Assignee" v-model="form.assignee" :users="userNames" :loading="usersLoading" @refresh="refreshUsers" /><small v-if="usersError" class="form-error" role="alert">Could not load team members: {{ usersError }} <button type="button" class="auth-switch board-retry" @click="refreshUsers()">Retry</button></small></div>
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
