<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../lib/api';
  import { taskLabel } from '../lib/taskLabels';

  interface Person { id: number; name: string; role: string; }
  interface Task {
    id: number; date: string; type: string; status: string; override: number;
    booking_id: number;
    guest_name: string | null; lock_code: string | null; notes: string | null;
    property_name: string; assignee_id: number; assignee_name: string;
    checkin_at: string; checkout_at: string;
  }

  let persons: Person[] = [];
  let tasks: Task[] = [];
  let selectedAssignee = '';
  let weekStart = getMondayStr(new Date());
  let loading = true;
  let error = '';

  $: groupedByDay = groupTasks(tasks);

  function getMondayStr(d: Date): string {
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(d);
    m.setUTCDate(m.getUTCDate() + diff);
    return m.toISOString().slice(0, 10);
  }

  function addDays(s: string, n: number): string {
    const d = new Date(s);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function shiftWeek(n: number) {
    weekStart = addDays(weekStart, n * 7);
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
      if (selectedAssignee) params.set('assignee', selectedAssignee);
      tasks = await get<Task[]>(`/api/plan?${params}`);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    persons = await get<Person[]>('/api/persons');
    await loadTasks();
  });
</script>

<div class="plan">
  <div class="toolbar">
    <div class="week-nav">
      <button on:click={() => shiftWeek(-1)}>‹ Prev</button>
      <span class="week-label">{weekStart} – {addDays(weekStart, 6)}</span>
      <button on:click={() => shiftWeek(1)}>Next ›</button>
    </div>
    <select bind:value={selectedAssignee} on:change={loadTasks}>
      <option value="">All assignees</option>
      {#each persons as p}
        <option value={String(p.id)}>{p.name}</option>
      {/each}
    </select>
  </div>

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
              <span class="task-type">{taskLabel(task.type)}</span>
              <span class="badge {task.status}">{task.status}</span>
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
            {#if task.notes}
              <p class="notes">{task.notes}</p>
            {/if}
            <div class="assignee">→ {task.assignee_name}{task.override ? ' (manual)' : ''}</div>
          </div>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .plan { max-width: 680px; margin: 0 auto; padding: 1rem; }

  .toolbar {
    display: flex; flex-wrap: wrap; gap: 0.75rem;
    align-items: center; margin-bottom: 1.25rem;
  }
  .week-nav { display: flex; align-items: center; gap: 0.5rem; }
  .week-nav button {
    background: #eee; border: none; padding: 0.35rem 0.75rem;
    border-radius: 6px; cursor: pointer; font-size: 0.95rem;
  }
  .week-label { font-weight: 600; font-size: 0.9rem; }
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

  .task-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; }
  .task-type { font-size: 1.05rem; font-weight: 600; }

  .badge {
    font-size: 0.75rem; padding: 0.15rem 0.55rem;
    border-radius: 12px; font-weight: 600; text-transform: uppercase;
  }
  .badge.pending { background: #FFF3CD; color: #856404; }
  .badge.done { background: #D1FAE5; color: #065F46; }

  .task-meta { font-size: 0.9rem; color: #666; display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.2rem; }
  .property { font-weight: 500; }
  .lock-code { color: #FF5A5F; font-size: 0.9rem; }

  .notes { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
  .assignee { font-size: 0.8rem; color: #aaa; margin-top: 0.4rem; }

  .msg { text-align: center; padding: 3rem; color: #999; }
  .msg.error { color: #c00; }
</style>
