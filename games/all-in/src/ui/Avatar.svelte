<script lang="ts">
  import { avatarFor } from './avatar';

  let { id, size = 26, label = '' }: { id: string; size?: number; label?: string } = $props();

  const avatar = $derived(avatarFor(id));
</script>

<span
  class="avatar"
  class:you={label === 'You'}
  style:--hue={avatar.hue}
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.6)}px"
  title={label || undefined}
  aria-hidden="true"
>{avatar.face}</span>
