<script lang="ts">
  import { onMount } from 'svelte';
  import { get, patch } from '../lib/api';
  import { taskLabel } from '../lib/taskLabels';
  import { formatShort } from '../lib/format';

  interface Person { id: number; name: string; role: string; }
  interface Property { id: number; name: string; }
  interface Task {
    id: number; date: string; type: string; status: string; override: number;
    note: string | null;
    booking_id: number;
    guest_name: string | null; lock_code: string | null; notes: string | null;
    property_name: string; assignee_id: number; assignee_name: string;
    checkin_at: string; checkout_at: string;
  }

  // member → rolling 7-day window anchored on today (slides daily).
  // admin  → fixed Monday–Sunday calendar week.
  export let mode: 'member' | 'admin' = 'member';

  function today(): string {
    // NB: assign `new Date()` to a local before returning. Returning it directly
    // (`return new Date()...`) lets esbuild's dev transform insert a `/* @__PURE__ */`
    // annotation + newline after `return`, which ASI turns into `return;` → undefined.
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  // Monday of the week containing `dateStr` (UTC), matching the backend's getMondayOf.
  function getMonday(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }

  let persons: Person[] = [];
  let properties: Property[] = [];
  let tasks: Task[] = [];
  let selectedAssignee = '';
  let selectedProperty = '';
  let weekStart = mode === 'admin' ? getMonday(today()) : today();
  let loading = true;
  let error = '';

  $: groupedByDay = groupTasks(tasks);

  function addDays(s: string, n: number): string {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function shiftWeek(n: number) {
    weekStart = addDays(weekStart, n * 7);
    loadTasks();
  }

  // Admin: jump to an arbitrary week via the native date picker, snapped to
  // the Monday–Sunday week containing the picked date.
  let dateInput: HTMLInputElement;

  function openDatePicker() {
    if (!dateInput) return;
    try {
      dateInput.showPicker();
    } catch {
      dateInput.focus();
      dateInput.click();
    }
  }

  function onPickDate(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (!v) return;
    weekStart = getMonday(v);
    loadTasks();
  }

  function groupTasks(list: Task[]) {
    const map = new Map<string, Task[]>();
    for (const t of list) {
      const arr = map.get(t.date) ?? [];
      arr.push(t);
      map.set(t.date, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  function formatDay(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  }

  async function loadTasks() {
    loading = true; error = '';
    try {
      const params = new URLSearchParams({ week: weekStart });
      // Member view shows only on-site (member) tasks; admin view can filter freely.
      if (mode === 'member') params.set('role', 'member');
      if (selectedAssignee) params.set('assignee', selectedAssignee);
      if (selectedProperty) params.set('property', selectedProperty);
      tasks = await get<Task[]>(`/api/plan?${params}`);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function toggleDone(task: Task) {
    const next = task.status === 'done' ? 'pending' : 'done';
    // Optimistic update so the card responds instantly
    tasks = tasks.map((t) => (t.id === task.id ? { ...t, status: next } : t));
    try {
      await patch(`/api/admin/tasks/${task.id}`, { status: next });
    } catch (e: any) {
      // Roll back on failure
      tasks = tasks.map((t) => (t.id === task.id ? { ...t, status: task.status } : t));
      error = e.message;
    }
  }

  onMount(async () => {
    // Filter dropdowns are admin-only; members don't need this data.
    if (mode === 'admin') {
      [persons, properties] = await Promise.all([
        get<Person[]>('/api/persons'),
        get<Property[]>('/api/properties'),
      ]);
    }
    await loadTasks();
  });
</script>

<div class="plan">
  {#if mode === 'admin'}
    <div class="toolbar">
      <div class="week-nav">
        <button on:click={() => shiftWeek(-1)} title="Previous 7 days">‹</button>
        <button class="week-label" on:click={openDatePicker} title="Pick a week">
          {formatShort(weekStart)} – {formatShort(addDays(weekStart, 6))}
        </button>
        <button on:click={() => shiftWeek(1)} title="Next 7 days">›</button>
        <input
          class="date-picker-hidden"
          type="date"
          bind:this={dateInput}
          value={weekStart}
          on:change={onPickDate}
        />
      </div>
      <div class="filters">
        <select bind:value={selectedAssignee} on:change={loadTasks}>
          <option value="">All assignees</option>
          {#each persons as p}
            <option value={String(p.id)}>{p.name}</option>
          {/each}
        </select>
        {#if properties.length > 1}
          <select bind:value={selectedProperty} on:change={loadTasks}>
            <option value="">All properties</option>
            {#each properties as p}
              <option value={String(p.id)}>{p.name}</option>
            {/each}
          </select>
        {/if}
      </div>
    </div>
  {:else}
    <h1 class="member-title">This Week</h1>
    <p class="member-range">{formatShort(weekStart)} – {formatShort(addDays(weekStart, 6))}</p>
  {/if}

  {#if loading}
    <p class="msg">Loading…</p>
  {:else if error}
    <p class="msg error">{error}</p>
  {:else if groupedByDay.length === 0}
    <p class="msg">No tasks this week.</p>
  {:else}
    {#each groupedByDay as [day, dayTasks]}
      <section class="day-group">
        <h2 class="day-header">{formatDay(day)}</h2>
        {#each dayTasks as task}
          <div class="task-card" class:done={task.status === 'done'}>
            <div class="task-top">
              <button
                class="check"
                class:checked={task.status === 'done'}
                title={task.status === 'done' ? 'Mark as not done' : 'Mark as done'}
                on:click={() => toggleDone(task)}
              >
                {task.status === 'done' ? '✓' : ''}
              </button>
              <span class="task-type">{taskLabel(task.type)}</span>
            </div>
            <div class="task-meta">
              <span class="property">{task.property_name}</span>
              {#if task.guest_name}
                <span>· {task.guest_name}</span>
              {/if}
              {#if task.lock_code && (task.type === 'lock_code_change')}
                <span class="lock-code">Code: <strong>{task.lock_code}</strong></span>
              {/if}
            </div>
            {#if task.note}
              <p class="task-note">{task.note}</p>
            {/if}
            {#if mode === 'admin'}
              <div class="assignee">→ {task.assignee_name}{task.override ? ' (manual)' : ''}</div>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .plan { max-width: 680px; margin: 0 auto; padding: 1rem; }

  .member-title { font-size: 1.6rem; font-weight: 800; margin: 0.25rem 0 0; color: #222; }
  .member-range { font-size: 1rem; color: #777; margin: 0.1rem 0 1.25rem; }

  .toolbar {
    display: flex; flex-wrap: wrap; gap: 0.75rem;
    align-items: center; justify-content: space-between; margin-bottom: 1.25rem;
  }
  .week-nav { position: relative; display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
  .week-nav > button:not(.week-label) {
    background: #eee; border: none; padding: 0.35rem 0.7rem;
    border-radius: 6px; cursor: pointer; font-size: 1rem; line-height: 1;
  }
  .week-label {
    background: transparent; border: none; cursor: pointer;
    font-weight: 600; font-size: 0.9rem; white-space: nowrap;
    min-width: 9rem; text-align: center; color: inherit;
    padding: 0.35rem 0.3rem; border-radius: 6px;
  }
  .week-label:hover { background: #f3f3f3; text-decoration: underline; }
  .date-picker-hidden {
    position: absolute; bottom: 0; left: 50%;
    width: 1px; height: 1px; padding: 0; border: 0;
    opacity: 0; pointer-events: none;
  }
  .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  select { padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid #ccc; font-size: 0.95rem; }

  .day-group { margin-bottom: 1.5rem; }
  .day-header {
    font-size: 1rem; font-weight: 700; color: #555;
    text-transform: uppercase; letter-spacing: 0.05em;
    margin-bottom: 0.5rem; padding-bottom: 0.25rem;
    border-bottom: 2px solid #FF5A5F;
  }

  .task-card {
    background: white; border-radius: 10px; padding: 0.9rem 1rem;
    margin-bottom: 0.6rem; box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    transition: opacity 0.2s;
  }
  .task-card.done { opacity: 0.5; }

  .task-top { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.3rem; }
  .task-type { font-size: 1.05rem; font-weight: 600; }
  .task-card.done .task-type { text-decoration: line-through; }

  .check {
    flex-shrink: 0;
    width: 26px; height: 26px;
    border: 2px solid #ccc; border-radius: 50%;
    background: white; cursor: pointer;
    font-size: 0.9rem; font-weight: 700; line-height: 1;
    color: white; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, border-color 0.15s;
  }
  .check.checked { background: #10B981; border-color: #10B981; }
  .check:hover { border-color: #10B981; }

  .task-meta { font-size: 0.9rem; color: #666; display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.2rem; }
  .property { font-weight: 500; }
  .lock-code { color: #FF5A5F; font-size: 0.9rem; }

  .task-note {
    font-size: 0.85rem; color: #555; background: #f9f9f9;
    border-left: 3px solid #FF5A5F; border-radius: 4px;
    padding: 0.4rem 0.6rem; margin-top: 0.4rem; white-space: pre-wrap;
  }
  .assignee { font-size: 0.8rem; color: #aaa; margin-top: 0.4rem; }

  .msg { text-align: center; padding: 3rem; color: #999; }
  .msg.error { color: #c00; }
</style>
