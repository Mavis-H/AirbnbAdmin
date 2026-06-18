<script lang="ts">
  import PlanView from './views/PlanView.svelte';
  import AdminView from './views/AdminView.svelte';

  // Route is decided by the URL path, not by a login:
  //   /        → member view (parents): the plan only, dead-simple, no nav
  //   /admin   → admin view (owner): a tab toggle between the plan and the management forms
  // Each person installs the PWA from their own URL, so their home-screen icon
  // always reopens the right view. Zero clicks, no account.
  const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

  // Only the admin route has an internal tab toggle.
  let adminTab: 'plan' | 'manage' = 'plan';
</script>

{#if isAdmin}
  <nav>
    <button class:active={adminTab === 'plan'} on:click={() => (adminTab = 'plan')}>This Week</button>
    <button class:active={adminTab === 'manage'} on:click={() => (adminTab = 'manage')}>Management</button>
  </nav>

  {#if adminTab === 'plan'}
    <PlanView mode="admin" />
  {:else}
    <AdminView />
  {/if}
{:else}
  <PlanView mode="member" />
{/if}

<style>
  nav {
    display: flex;
    background: #FF5A5F;
    padding: 0.75rem 1rem;
    gap: 0.5rem;
  }
  nav button {
    background: transparent;
    border: 2px solid white;
    color: white;
    padding: 0.4rem 1rem;
    border-radius: 20px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  nav button.active {
    background: white;
    color: #FF5A5F;
  }
</style>
