<script lang="ts">
  import { onMount } from 'svelte';
  import { get, patch, post, del } from '../lib/api';
  import { taskLabel } from '../lib/taskLabels';

  interface Booking {
    id: number; property_name: string; checkin_at: string; checkout_at: string;
    guest_name: string | null; lock_code: string | null; notes: string | null;
  }
  interface Takeover {
    id: number; from_person_id: number; to_person_id: number;
    start_date: string; end_date: string; from_name: string; to_name: string;
  }
  interface Person { id: number; name: string; role: string; }
  interface Task {
    id: number; date: string; type: string; status: string; assignee_id: number; assignee_name: string; override: number;
  }

  let bookings: Booking[] = [];
  let takeovers: Takeover[] = [];
  let persons: Person[] = [];
  let selectedBooking: Booking | null = null;
  let bookingTasks: Task[] = [];

  // Edit state
  let editGuestName = '';
  let editLockCode = '';
  let editNotes = '';
  let saving = false;

  // New takeover form
  let toForm = { from_person_id: '', to_person_id: '', start_date: '', end_date: '' };

  onMount(async () => {
    await reload();
  });

  async function reload() {
    [bookings, takeovers, persons] = await Promise.all([
      get<Booking[]>('/api/admin/bookings'),
      get<Takeover[]>('/api/admin/takeovers'),
      get<Person[]>('/api/persons'),
    ]);
  }

  async function selectBooking(b: Booking) {
    selectedBooking = b;
    editGuestName = b.guest_name ?? '';
    editLockCode = b.lock_code ?? '';
    editNotes = b.notes ?? '';
    const res = await get<Task[]>(`/api/plan?week=${b.checkin_at.slice(0, 10)}`);
    bookingTasks = res.filter((t: Task & { booking_id: number }) => (t as any).booking_id === b.id);
  }

  async function saveBooking() {
    if (!selectedBooking) return;
    saving = true;
    await patch(`/api/admin/bookings/${selectedBooking.id}`, {
      guest_name: editGuestName || null,
      lock_code: editLockCode || null,
      notes: editNotes || null,
    });
    await reload();
    selectedBooking = { ...selectedBooking, guest_name: editGuestName, lock_code: editLockCode, notes: editNotes };
    saving = false;
  }

  async function reassignTask(taskId: number, event: Event) {
    const assigneeId = (event.target as HTMLSelectElement).value;
    await patch(`/api/admin/tasks/${taskId}`, { assignee_id: Number(assigneeId) });
    if (selectedBooking) await selectBooking(selectedBooking);
  }

  async function addTakeover() {
    await post('/api/admin/takeovers', {
      from_person_id: Number(toForm.from_person_id),
      to_person_id: Number(toForm.to_person_id),
      start_date: toForm.start_date,
      end_date: toForm.end_date,
    });
    toForm = { from_person_id: '', to_person_id: '', start_date: '', end_date: '' };
    takeovers = await get<Takeover[]>('/api/admin/takeovers');
  }

  async function deleteTakeover(id: number) {
    await del(`/api/admin/takeovers/${id}`);
    takeovers = await get<Takeover[]>('/api/admin/takeovers');
  }
</script>

<div class="admin">
  <div class="cols">
    <!-- Booking list -->
    <aside class="booking-list">
      <h2>Bookings</h2>
      {#each bookings as b}
        <button
          class="booking-item"
          class:selected={selectedBooking?.id === b.id}
          on:click={() => selectBooking(b)}
        >
          <span class="prop">{b.property_name}</span>
          <span class="dates">{b.checkin_at.slice(0,16)} → {b.checkout_at.slice(0,16)}</span>
          {#if b.guest_name}<span class="guest">{b.guest_name}</span>{/if}
        </button>
      {/each}
    </aside>

    <!-- Booking detail -->
    <main class="booking-detail">
      {#if selectedBooking}
        <h2>{selectedBooking.property_name} · {selectedBooking.checkin_at.slice(0,10)}</h2>

        <section class="form-section">
          <label>Guest name
            <input bind:value={editGuestName} placeholder="Guest name" />
          </label>
          <label>Lock code
            <input bind:value={editLockCode} placeholder="e.g. 482736" />
          </label>
          <label>Notes
            <textarea bind:value={editNotes} rows="3" placeholder="Any notes for this stay…" />
          </label>
          <button class="btn-primary" on:click={saveBooking} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </section>

        {#if bookingTasks.length > 0}
          <section class="task-section">
            <h3>Tasks</h3>
            {#each bookingTasks as t}
              <div class="task-row">
                <span class="task-date">{t.date}</span>
                <span class="task-type">{taskLabel(t.type)}</span>
                <select value={String(t.assignee_id)} on:change={(e) => reassignTask(t.id, e)}>
                  {#each persons as p}
                    <option value={String(p.id)}>{p.name}</option>
                  {/each}
                </select>
                {#if t.override}<span class="manual-tag">manual</span>{/if}
              </div>
            {/each}
          </section>
        {/if}
      {:else}
        <p class="placeholder">Select a booking to edit.</p>
      {/if}
    </main>
  </div>

  <!-- Takeovers -->
  <section class="takeover-section">
    <h2>Takeover Periods</h2>
    {#each takeovers as t}
      <div class="takeover-row">
        <span>{t.from_name} → {t.to_name}</span>
        <span>{t.start_date} to {t.end_date}</span>
        <button class="btn-danger" on:click={() => deleteTakeover(t.id)}>Remove</button>
      </div>
    {/each}

    <div class="takeover-form">
      <select bind:value={toForm.from_person_id}>
        <option value="">From person…</option>
        {#each persons as p}<option value={String(p.id)}>{p.name}</option>{/each}
      </select>
      <select bind:value={toForm.to_person_id}>
        <option value="">To person…</option>
        {#each persons as p}<option value={String(p.id)}>{p.name}</option>{/each}
      </select>
      <input type="date" bind:value={toForm.start_date} />
      <input type="date" bind:value={toForm.end_date} />
      <button class="btn-primary"
        on:click={addTakeover}
        disabled={!toForm.from_person_id || !toForm.to_person_id || !toForm.start_date || !toForm.end_date}
      >Add</button>
    </div>
  </section>
</div>

<style>
  .admin { max-width: 1000px; margin: 0 auto; padding: 1rem; }

  .cols { display: flex; gap: 1.5rem; margin-bottom: 2rem; }

  .booking-list { width: 240px; flex-shrink: 0; }
  .booking-list h2 { font-size: 1rem; margin-bottom: 0.5rem; color: #444; }

  .booking-item {
    display: block; width: 100%; text-align: left;
    background: white; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 0.6rem 0.8rem; margin-bottom: 0.4rem; cursor: pointer;
  }
  .booking-item.selected { border-color: #FF5A5F; background: #fff5f5; }
  .booking-item .prop { display: block; font-weight: 600; font-size: 0.9rem; }
  .booking-item .dates { display: block; font-size: 0.8rem; color: #888; }
  .booking-item .guest { display: block; font-size: 0.8rem; color: #555; }

  .booking-detail { flex: 1; }
  .booking-detail h2 { font-size: 1.1rem; margin-bottom: 0.75rem; }
  .placeholder { color: #aaa; padding-top: 2rem; }

  .form-section { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.5rem; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #555; font-weight: 600; }
  input, textarea, select {
    padding: 0.45rem 0.65rem; border: 1px solid #ccc; border-radius: 6px;
    font-size: 0.95rem; font-family: inherit;
  }
  textarea { resize: vertical; }

  .btn-primary {
    background: #FF5A5F; color: white; border: none;
    padding: 0.5rem 1.25rem; border-radius: 6px; cursor: pointer;
    font-size: 0.95rem; font-weight: 600; align-self: flex-start;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-danger {
    background: #fee2e2; color: #b91c1c; border: none;
    padding: 0.3rem 0.8rem; border-radius: 6px; cursor: pointer;
    font-size: 0.85rem;
  }

  .task-section h3 { font-size: 0.95rem; margin-bottom: 0.5rem; color: #444; }
  .task-row {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.5rem; background: white; border-radius: 6px;
    border: 1px solid #eee; margin-bottom: 0.35rem; flex-wrap: wrap;
  }
  .task-date { font-size: 0.8rem; color: #999; min-width: 80px; }
  .task-type { font-size: 0.9rem; font-weight: 500; flex: 1; min-width: 140px; }
  .manual-tag { font-size: 0.7rem; background: #FFF3CD; color: #856404; padding: 0.1rem 0.4rem; border-radius: 4px; }

  .takeover-section { border-top: 1px solid #eee; padding-top: 1.5rem; }
  .takeover-section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: #444; }
  .takeover-row {
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
    padding: 0.5rem; background: white; border: 1px solid #eee;
    border-radius: 6px; margin-bottom: 0.4rem;
  }
  .takeover-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; align-items: flex-end; }
</style>
