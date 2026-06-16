<script lang="ts">
  import PlanView from './views/PlanView.svelte';
  import AdminView from './views/AdminView.svelte';

  let view: 'plan' | 'admin' = 'plan';
</script>

<nav>
  <button class:active={view === 'plan'} on:click={() => (view = 'plan')}>This Week</button>
  <button class:active={view === 'admin'} on:click={() => (view = 'admin')}>Admin</button>
</nav>

{#if view === 'plan'}
  <PlanView />
{:else}
  <AdminView />
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
