<script lang="ts">
  import { onMount } from 'svelte';
  import { get, patch, post, del } from '../lib/api';
  import { taskLabel } from '../lib/taskLabels';
  import { formatDate, formatDateTime } from '../lib/format';
  import { t } from '../lib/strings';

  interface Booking {
    id: number; property_id: number; property_name: string; checkin_at: string; checkout_at: string;
    guest_name: string | null; lock_code: string | null; notes: string | null;
  }
  interface Takeover {
    id: number; from_person_id: number; to_person_id: number;
    start_date: string; end_date: string; from_name: string; to_name: string;
  }
  interface Person { id: number; name: string; role: string; }
  interface Property {
    id: number; name: string; ical_url: string;
    checkin_time: string; checkout_time: string; default_passcode: string | null;
  }
  interface Task {
    id: number; date: string; type: string; status: string; assignee_id: number; assignee_name: string; override: number;
    note: string | null; booking_id: number;
  }

  // Side-nav: which management section is showing
  type Section = 'bookings' | 'takeovers' | 'properties';
  let section: Section = 'bookings';
  const sections: { id: Section; label: string }[] = [
    { id: 'bookings', label: t.admin.sections.bookings },
    { id: 'takeovers', label: t.admin.sections.takeovers },
    { id: 'properties', label: t.admin.sections.properties },
  ];

  let bookings: Booking[] = [];
  let takeovers: Takeover[] = [];
  let persons: Person[] = [];
  let properties: Property[] = [];
  let selectedBooking: Booking | null = null;
  let bookingTasks: Task[] = [];

  // Booking list filter (chips by property)
  let bookingPropFilter: number | null = null;
  $: filteredBookings = bookingPropFilter == null
    ? bookings
    : bookings.filter((b) => b.property_id === bookingPropFilter);

  function onPropFilterChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    bookingPropFilter = v === '' ? null : Number(v);
  }

  // Property edit state
  let syncingId: number | null = null;
  let showNewProperty = false;
  let newProp = { name: '', ical_url: '', checkin_time: '15:00:00', checkout_time: '11:00:00', default_passcode: '' };
  let dirtyPropIds = new Set<number>();
  let focusedPropId: number | null = null;
  let propSavedFlashId: number | null = null;

  // Booking edit state
  let editGuestName = '';
  let editLockCode = '';
  let editNotes = '';
  let saving = false;
  let savedFlash = false;
  let bookingFocused = false;
  $: bookingDirty = !!selectedBooking && (
    editGuestName !== (selectedBooking.guest_name ?? '') ||
    editLockCode !== (selectedBooking.lock_code ?? '') ||
    editNotes !== (selectedBooking.notes ?? '')
  );

  // New takeover form
  let showTakeoverForm = false;
  let toForm = { from_person_id: '', to_person_id: '', start_date: '', end_date: '' };

  function markPropDirty(id: number) {
    dirtyPropIds.add(id);
    dirtyPropIds = dirtyPropIds;
  }

  function onPropFocusOut(e: FocusEvent, id: number) {
    const card = e.currentTarget as HTMLElement;
    if (!card.contains(e.relatedTarget as Node | null) && focusedPropId === id) {
      focusedPropId = null;
    }
  }

  function onBookingFocusOut(e: FocusEvent) {
    const section = e.currentTarget as HTMLElement;
    if (!section.contains(e.relatedTarget as Node | null)) bookingFocused = false;
  }

  onMount(async () => {
    await reload();
  });

  async function reload() {
    [bookings, takeovers, persons, properties] = await Promise.all([
      get<Booking[]>('/api/admin/bookings'),
      get<Takeover[]>('/api/admin/takeovers'),
      get<Person[]>('/api/persons'),
      get<Property[]>('/api/admin/properties'),
    ]);
  }

  async function saveProperty(p: Property) {
    await patch(`/api/admin/properties/${p.id}`, {
      name: p.name,
      ical_url: p.ical_url,
      checkin_time: p.checkin_time,
      checkout_time: p.checkout_time,
      default_passcode: p.default_passcode || null,
    });
    dirtyPropIds.delete(p.id);
    dirtyPropIds = dirtyPropIds;
    await reload();
    propSavedFlashId = p.id;
    setTimeout(() => {
      if (propSavedFlashId === p.id) propSavedFlashId = null;
    }, 2000);
  }

  async function addProperty() {
    await post('/api/admin/properties', {
      name: newProp.name,
      ical_url: newProp.ical_url,
      checkin_time: newProp.checkin_time,
      checkout_time: newProp.checkout_time,
      default_passcode: newProp.default_passcode || null,
    });
    newProp = { name: '', ical_url: '', checkin_time: '15:00:00', checkout_time: '11:00:00', default_passcode: '' };
    showNewProperty = false;
    await reload();
  }

  async function syncProperty(id: number) {
    syncingId = id;
    try {
      await post(`/api/admin/properties/${id}/sync`);
      await reload();
    } finally {
      syncingId = null;
    }
  }

  async function selectBooking(b: Booking) {
    selectedBooking = b;
    editGuestName = b.guest_name ?? '';
    editLockCode = b.lock_code ?? '';
    editNotes = b.notes ?? '';
    editingNoteTaskId = null;
    bookingTasks = await get<Task[]>(`/api/admin/bookings/${b.id}/tasks`);
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
    savedFlash = true;
    setTimeout(() => (savedFlash = false), 2000);
  }

  function closeBooking() {
    selectedBooking = null;
    bookingTasks = [];
  }

  async function reassignTask(taskId: number, event: Event) {
    const assigneeId = (event.target as HTMLSelectElement).value;
    await patch(`/api/admin/tasks/${taskId}`, { assignee_id: Number(assigneeId) });
    if (selectedBooking) await selectBooking(selectedBooking);
  }

  // Per-task note editing
  let editingNoteTaskId: number | null = null;
  let editNoteText = '';

  function startEditNote(t: Task) {
    editingNoteTaskId = t.id;
    editNoteText = t.note ?? '';
  }

  async function saveTaskNote(taskId: number) {
    await patch(`/api/admin/tasks/${taskId}`, { note: editNoteText.trim() });
    editingNoteTaskId = null;
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
    showTakeoverForm = false;
    takeovers = await get<Takeover[]>('/api/admin/takeovers');
  }

  async function deleteTakeover(id: number) {
    await del(`/api/admin/takeovers/${id}`);
    takeovers = await get<Takeover[]>('/api/admin/takeovers');
  }
</script>

<div class="admin">
  <nav class="side-nav">
    {#each sections as s}
      <button class:active={section === s.id} on:click={() => (section = s.id)}>
        {s.label}
      </button>
    {/each}
  </nav>

  <div class="content">
  {#if section === 'bookings'}
  <div class="cols">
    <!-- Booking list -->
    <aside class="booking-list">
      <h2>{t.admin.sections.bookings}</h2>
      {#if properties.length > 1}
        <select
          class="prop-filter"
          value={bookingPropFilter == null ? '' : String(bookingPropFilter)}
          on:change={onPropFilterChange}
        >
          <option value="">{t.admin.allProperties}</option>
          {#each properties as p}
            <option value={String(p.id)}>{p.name}</option>
          {/each}
        </select>
      {/if}
      {#each filteredBookings as b}
        <button
          class="booking-item"
          class:selected={selectedBooking?.id === b.id}
          on:click={() => selectBooking(b)}
        >
          <span class="prop">{b.property_name}</span>
          <span class="dates">{formatDate(b.checkin_at)} → {formatDate(b.checkout_at)}</span>
          {#if b.guest_name}<span class="guest">{b.guest_name}</span>{/if}
        </button>
      {/each}
    </aside>

    <!-- Booking detail -->
    <main class="booking-detail">
      {#if selectedBooking}
        <div class="detail-header">
          <h2>
            {selectedBooking.property_name}
            <span class="stay-window">
              {formatDateTime(selectedBooking.checkin_at)} → {formatDateTime(selectedBooking.checkout_at)}
            </span>
          </h2>
          <button class="btn-close" title={t.admin.close} on:click={closeBooking}>✕</button>
        </div>

        <section
          class="form-section"
          on:focusin={() => (bookingFocused = true)}
          on:focusout={onBookingFocusOut}
        >
          <label>{t.admin.guestName}
            <input bind:value={editGuestName} placeholder={t.admin.guestNamePh} />
          </label>
          <label>{t.admin.lockCode}
            <input bind:value={editLockCode} placeholder={t.admin.lockCodePh} />
          </label>
          <label>{t.admin.notes}
            <textarea bind:value={editNotes} rows="3" placeholder={t.admin.notesPh} />
          </label>
          {#if bookingDirty || bookingFocused || savedFlash}
            <div class="save-row">
              <button class="btn-primary" on:click={saveBooking} disabled={saving || !bookingDirty}>
                {saving ? t.admin.saving : t.admin.save}
              </button>
              {#if savedFlash}<span class="saved-flash">{t.admin.saved}</span>{/if}
            </div>
          {/if}
        </section>

        {#if bookingTasks.length > 0}
          <section class="task-section">
            <h3>{t.admin.tasksTitle}</h3>
            {#each bookingTasks as task}
              <div class="task-item">
                <div class="task-row">
                  <span class="task-date">{formatDate(task.date)}</span>
                  <span class="task-type">{taskLabel(task.type)}</span>
                  <select value={String(task.assignee_id)} on:change={(e) => reassignTask(task.id, e)}>
                    {#each persons as p}
                      <option value={String(p.id)}>{p.name}</option>
                    {/each}
                  </select>
                  {#if task.override}<span class="manual-tag">{t.admin.manual}</span>{/if}
                  <button class="btn-note" on:click={() => startEditNote(task)}>
                    {task.note ? t.admin.editNote : t.admin.addNote}
                  </button>
                </div>
                {#if editingNoteTaskId === task.id}
                  <div class="note-editor">
                    <textarea bind:value={editNoteText} rows="2" placeholder={t.admin.notePh} />
                    <div class="note-actions">
                      <button class="btn-primary" on:click={() => saveTaskNote(task.id)}>{t.admin.saveNote}</button>
                      <button class="btn-secondary" on:click={() => (editingNoteTaskId = null)}>{t.admin.cancel}</button>
                    </div>
                  </div>
                {:else if task.note}
                  <p class="task-note">{task.note}</p>
                {/if}
              </div>
            {/each}
          </section>
        {/if}
      {:else}
        <p class="placeholder">{t.admin.selectBooking}</p>
      {/if}
    </main>
  </div>
  {/if}

  {#if section === 'takeovers'}
  <!-- Takeovers -->
  <section class="takeover-section">
    <h2>{t.admin.takeoverTitle}</h2>
    {#each takeovers as tk}
      <div class="takeover-row">
        <span>{tk.from_name} → {tk.to_name}</span>
        <span>{tk.start_date} {t.admin.dateTo} {tk.end_date}</span>
        <button class="btn-danger" on:click={() => deleteTakeover(tk.id)}>{t.admin.remove}</button>
      </div>
    {/each}

    {#if showTakeoverForm}
      <div class="takeover-form">
        <select bind:value={toForm.from_person_id}>
          <option value="">{t.admin.fromPerson}</option>
          {#each persons as p}<option value={String(p.id)}>{p.name}</option>{/each}
        </select>
        <select bind:value={toForm.to_person_id}>
          <option value="">{t.admin.toPerson}</option>
          {#each persons as p}<option value={String(p.id)}>{p.name}</option>{/each}
        </select>
        <input type="date" bind:value={toForm.start_date} />
        <input type="date" bind:value={toForm.end_date} />
        <button class="btn-primary"
          on:click={addTakeover}
          disabled={!toForm.from_person_id || !toForm.to_person_id || !toForm.start_date || !toForm.end_date}
        >{t.admin.add}</button>
        <button class="btn-secondary" on:click={() => (showTakeoverForm = false)}>{t.admin.cancel}</button>
      </div>
    {:else}
      <button class="btn-add" on:click={() => (showTakeoverForm = true)}>{t.admin.addTakeover}</button>
    {/if}
  </section>
  {/if}

  {#if section === 'properties'}
  <!-- Properties -->
  <section class="property-section">
    <h2>{t.admin.sections.properties}</h2>
    {#each properties as p (p.id)}
      <div
        class="property-card"
        on:focusin={() => (focusedPropId = p.id)}
        on:focusout={(e) => onPropFocusOut(e, p.id)}
        on:input={() => markPropDirty(p.id)}
      >
        <div class="property-grid">
          <label>{t.admin.propName}
            <input bind:value={p.name} />
          </label>
          <label>{t.admin.icalUrl}
            <input bind:value={p.ical_url} placeholder={t.admin.icalPh} />
          </label>
          <label>{t.admin.checkinTime}
            <input type="time" bind:value={p.checkin_time} />
          </label>
          <label>{t.admin.checkoutTime}
            <input type="time" bind:value={p.checkout_time} />
          </label>
          <label>{t.admin.defaultPasscode}
            <input bind:value={p.default_passcode} placeholder={t.admin.passcodePh} />
          </label>
        </div>
        <div class="property-actions">
          {#if dirtyPropIds.has(p.id) || focusedPropId === p.id || propSavedFlashId === p.id}
            <button class="btn-primary" on:click={() => saveProperty(p)} disabled={!dirtyPropIds.has(p.id)}>
              {t.admin.save}
            </button>
            {#if propSavedFlashId === p.id}<span class="saved-flash">{t.admin.saved}</span>{/if}
          {/if}
          <button class="btn-secondary" on:click={() => syncProperty(p.id)} disabled={syncingId === p.id}>
            {syncingId === p.id ? t.admin.syncing : t.admin.syncIcal}
          </button>
        </div>
      </div>
    {/each}

    {#if showNewProperty}
      <h3>{t.admin.addPropertyTitle}</h3>
      <div class="property-card">
        <div class="property-grid">
          <label>{t.admin.propName}
            <input bind:value={newProp.name} placeholder={t.admin.namePh} />
          </label>
          <label>{t.admin.icalUrl}
            <input bind:value={newProp.ical_url} placeholder={t.admin.icalPh} />
          </label>
          <label>{t.admin.checkinTime}
            <input type="time" bind:value={newProp.checkin_time} />
          </label>
          <label>{t.admin.checkoutTime}
            <input type="time" bind:value={newProp.checkout_time} />
          </label>
          <label>{t.admin.defaultPasscode}
            <input bind:value={newProp.default_passcode} placeholder={t.admin.passcodePh} />
          </label>
        </div>
        <div class="property-actions">
          <button class="btn-primary" on:click={addProperty} disabled={!newProp.name || !newProp.ical_url}>
            {t.admin.addPropertyBtn}
          </button>
          <button class="btn-secondary" on:click={() => (showNewProperty = false)}>{t.admin.cancel}</button>
        </div>
      </div>
    {:else}
      <button class="btn-add" on:click={() => (showNewProperty = true)}>{t.admin.addProperty}</button>
    {/if}
  </section>
  {/if}
  </div>
</div>

<style>
  .admin { display: flex; gap: 1.5rem; max-width: 1100px; margin: 0 auto; padding: 1rem; align-items: flex-start; }

  .side-nav {
    display: flex; flex-direction: column; gap: 0.25rem;
    width: 160px; flex-shrink: 0; position: sticky; top: 1rem;
  }
  .side-nav button {
    text-align: left; background: transparent; border: none;
    padding: 0.55rem 0.85rem; border-radius: 8px; cursor: pointer;
    font-size: 0.95rem; font-weight: 600; color: #555;
  }
  .side-nav button:hover { background: #f3f3f3; }
  .side-nav button.active { background: #fff5f5; color: #FF5A5F; }

  .content { flex: 1; min-width: 0; border-left: 1px solid #e5e5e5; padding-left: 1.5rem; }

  .cols { display: flex; gap: 1.5rem; margin-bottom: 2rem; }

  .booking-list { width: 240px; flex-shrink: 0; }
  .booking-list h2 { font-size: 1rem; margin-bottom: 0.5rem; color: #444; }

  .prop-filter { width: 100%; margin-bottom: 0.75rem; cursor: pointer; }

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
  .detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.75rem; }
  .booking-detail h2 { font-size: 1.1rem; }
  .stay-window { display: block; font-size: 0.8rem; font-weight: 400; color: #888; margin-top: 0.2rem; }
  .btn-close {
    background: #f0f0f0; border: none; border-radius: 6px;
    width: 28px; height: 28px; cursor: pointer; font-size: 0.9rem;
    color: #666; flex-shrink: 0; line-height: 1;
  }
  .btn-close:hover { background: #e0e0e0; }
  .placeholder { color: #aaa; padding-top: 2rem; }

  .save-row { display: flex; align-items: center; gap: 0.75rem; }
  .saved-flash { color: #065F46; font-size: 0.85rem; font-weight: 600; }

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
  .task-item {
    background: white; border-radius: 6px; border: 1px solid #eee;
    margin-bottom: 0.35rem; padding: 0.5rem; overflow: hidden;
  }
  .task-row {
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  }
  .task-date { font-size: 0.8rem; color: #999; min-width: 80px; }
  .task-type { font-size: 0.9rem; font-weight: 500; flex: 1; min-width: 140px; }
  .manual-tag { font-size: 0.7rem; background: #FFF3CD; color: #856404; padding: 0.1rem 0.4rem; border-radius: 4px; }

  .btn-note {
    background: transparent; border: 1px solid #ddd; color: #666;
    padding: 0.2rem 0.6rem; border-radius: 6px; cursor: pointer;
    font-size: 0.78rem; font-weight: 500;
  }
  .btn-note:hover { background: #f5f5f5; border-color: #ccc; }
  .task-note {
    font-size: 0.82rem; color: #555;
    border-top: 1px dashed #e5e5e5;
    padding: 0.45rem 0.1rem 0.1rem; margin: 0.45rem 0 0; white-space: pre-wrap;
  }
  .note-editor {
    border-top: 1px dashed #e5e5e5;
    padding-top: 0.5rem; margin-top: 0.5rem;
  }
  .note-editor textarea { width: 100%; box-sizing: border-box; margin-bottom: 0.4rem; }
  .note-actions { display: flex; gap: 0.5rem; }

  .takeover-section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: #444; }
  .takeover-row {
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
    padding: 0.5rem; background: white; border: 1px solid #eee;
    border-radius: 6px; margin-bottom: 0.4rem;
  }
  .takeover-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; align-items: flex-end; }

  .property-section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: #444; }
  .property-section h3 { font-size: 0.9rem; margin: 1.25rem 0 0.5rem; color: #666; }
  .property-card {
    background: white; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 1rem; margin-bottom: 0.75rem;
  }
  .property-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.6rem; margin-bottom: 0.75rem;
  }
  .property-actions { display: flex; gap: 0.5rem; }
  .btn-secondary {
    background: #f0f0f0; color: #444; border: none;
    padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;
    font-size: 0.95rem; font-weight: 600;
  }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-add {
    background: white; color: #FF5A5F; border: 1.5px dashed #FF5A5F;
    padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;
    font-size: 0.9rem; font-weight: 600; margin-top: 0.5rem;
  }
  .btn-add:hover { background: #fff5f5; }
</style>
