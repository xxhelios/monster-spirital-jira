<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { ApiError, request } from './api';
import { priorities, statuses, type Priority, type Status, type Task, type TaskDetails } from './tasks';

const notice = ref('');
const username = ref('');
const authMode = ref<'login' | 'signup'>('login');
const credentials = reactive({ username: '', password: '' });
const authError = ref('');
const authBusy = ref(false);
const loading = ref(true);
const tasks = ref<Task[]>([]);
const busy = ref(false);
let refreshGeneration = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function handleError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    username.value = '';
    tasks.value = [];
    dialogVisible.value = false;
    authError.value = error.message;
  } else {
    notice.value = message(error);
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

async function authenticate() {
  authBusy.value = true;
  authError.value = '';
  try {
    const result = await request<{ user: { username: string } }>(`/auth/${authMode.value}`, { method: 'POST', body: credentials });
    username.value = result.user.username;
    credentials.password = '';
    await refreshTasks();
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
    username.value = '';
    tasks.value = [];
    notice.value = '';
  } catch (error) {
    handleError(error);
  }
}

onMounted(async () => {
  try {
    const result = await request<{ user: { username: string } }>('/auth/me');
    username.value = result.user.username;
    await refreshTasks();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) authError.value = message(error);
  } finally {
    loading.value = false;
  }
  refreshTimer = setInterval(() => {
    if (username.value && !busy.value) void refreshTasks();
  }, 15000);
});
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); });

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
const progress = computed(() => tasks.value.length ? Math.round(completed.value / tasks.value.length * 100) : 0);
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
  const nextStatus = statuses[statuses.indexOf(task.status) + direction];
  if (!nextStatus || busy.value) return;
  busy.value = true;
  ++refreshGeneration;
  try {
    await request(`/tasks/${task.id}`, { method: 'PUT', body: { ...task, status: nextStatus } });
    await refreshTasks();
  } catch (error) {
    handleError(error);
  } finally {
    busy.value = false;
  }
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
      <div class="brand"><span class="brand-mark"><i class="pi pi-compass"></i></span><span>orbit<span class="brand-dot">.</span></span></div>
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
      <a class="brand" href="#" aria-label="Orbit home">
        <span class="brand-mark"><i class="pi pi-compass"></i></span>
        <span>orbit<span class="brand-dot">.</span></span>
      </a>
      <div class="workspace-switcher">
        <div class="workspace-icon">O</div>
        <div class="workspace-text"><strong>Orbit Studio</strong><span>Workspace</span></div>
        <i class="pi pi-angle-down"></i>
      </div>
      <p class="nav-label">WORKSPACE</p>
      <nav aria-label="Workspace navigation">
        <a class="nav-link active" href="#board" aria-current="page"><i class="pi pi-th-large"></i> Board <span class="nav-indicator"></span></a>
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
        <div class="breadcrumb"><span>Workspace</span><i class="pi pi-angle-right"></i><strong>Project board</strong></div>
        <div class="topbar-right"><span class="topbar-label">{{ username }}</span><button class="logout-button" @click="logout">Sign out</button><span class="avatar lavender">{{ initials(username) }}</span></div>
      </header>
      <div class="content" id="board">
        <div v-if="notice" class="notice" role="alert"><i class="pi pi-exclamation-triangle"></i> {{ notice }}</div>
        <div class="page-heading">
          <div>
            <div class="eyebrow"><span class="eyebrow-dot"></span> YOUR WORKSPACE</div>
            <h1>Project board<span class="heading-dot">.</span></h1>
            <p>Good things happen when great work comes together.</p>
          </div>
          <Button label="Create task" icon="pi pi-plus" class="create-button" @click="openTask()" />
        </div>

        <section class="overview" aria-label="Project overview">
          <div class="overview-main">
            <div class="overview-icon"><i class="pi pi-bolt"></i></div>
            <div><span class="overview-kicker">THE BIG PICTURE</span><h2>Let's make it happen.</h2><p>A little clarity goes a long way. Here's where your work stands.</p></div>
          </div>
          <div class="overview-progress">
            <div class="progress-label"><span>Project progress</span><strong>{{ progress }}%</strong></div>
            <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" aria-label="Project progress"><div :style="{ width: `${progress}%` }"></div></div>
            <p>{{ completed }} of {{ tasks.length }} tasks completed</p>
          </div>
        </section>

        <div class="board-header">
          <div><h2>Board <span class="task-total">{{ tasks.length }}</span></h2><p>All your team's work, in one place.</p></div>
          <div class="filters">
            <label class="search-box"><i class="pi pi-search"></i><span class="sr-only">Search tasks</span><input v-model="search" placeholder="Search tasks..." type="search"></label>
            <label class="filter-box"><i class="pi pi-sliders-h"></i><span class="sr-only">Filter by priority</span><select v-model="priorityFilter"><option>All priorities</option><option v-for="priority in priorities" :key="priority">{{ priority }}</option></select><i class="pi pi-angle-down"></i></label>
          </div>
        </div>

        <div class="board">
          <section v-for="(status, columnIndex) in statuses" :key="status" class="column" :aria-label="status">
            <div class="column-heading">
              <div><span class="status-dot" :class="`status-${columnIndex}`"></span><h3>{{ status }}</h3><span class="column-count">{{ filteredTasks.filter((task) => task.status === status).length }}</span></div>
              <button class="icon-button" :aria-label="`Add task to ${status}`" @click="openTask(undefined, status)"><i class="pi pi-plus"></i></button>
            </div>
            <div class="task-list">
              <article v-for="task in filteredTasks.filter((item) => item.status === status)" :key="task.id" class="task-card">
                <div class="card-top"><span class="task-id">{{ task.id }}</span><button class="icon-button edit-button" :aria-label="`Edit ${task.title}`" @click="openTask(task)"><i class="pi pi-ellipsis-h"></i></button></div>
                <button class="task-title" @click="openTask(task)">{{ task.title }}</button>
                <p class="task-description">{{ task.description || 'No description yet.' }}</p>
                <div class="card-tags"><span v-if="task.label" class="tag category-tag">{{ task.label }}</span><span class="tag priority-tag" :class="`priority-${task.priority.toLowerCase()}`"><i class="pi pi-flag-fill"></i>{{ task.priority }}</span></div>
                <div class="card-footer">
                  <div class="assignee"><span class="avatar" :class="avatarClass(task.assignee)">{{ initials(task.assignee) }}</span><span>{{ task.assignee || 'Unassigned' }}</span></div>
                  <div class="move-actions"><button v-if="columnIndex > 0" class="icon-button" :disabled="busy" :aria-label="`Move ${task.title} to ${statuses[columnIndex - 1]}`" @click="moveTask(task, -1)"><i class="pi pi-arrow-left"></i></button><button v-if="columnIndex < statuses.length - 1" class="icon-button" :disabled="busy" :aria-label="`Move ${task.title} to ${statuses[columnIndex + 1]}`" @click="moveTask(task, 1)"><i class="pi pi-arrow-right"></i></button></div>
                </div>
              </article>
              <div v-if="!filteredTasks.some((task) => task.status === status)" class="empty-column">No tasks here yet.</div>
              <button class="add-card" @click="openTask(undefined, status)"><i class="pi pi-plus"></i> Add a task</button>
            </div>
          </section>
        </div>
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
          <div><label for="task-assignee">Assignee</label><InputText id="task-assignee" v-model="form.assignee" placeholder="e.g. Alex Morgan" maxlength="80" /></div>
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
