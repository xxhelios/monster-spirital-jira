<script setup lang="ts">
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';

defineProps<{
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <Dialog :visible="visible" modal :header="title" :style="{ width: 'min(94vw, 440px)' }" @update:visible="!$event && emit('cancel')">
    <p class="confirmation-message">{{ message }}</p>
    <div class="dialog-actions">
      <span class="actions-spacer"></span>
      <Button type="button" label="Cancel" severity="secondary" text autofocus @click="emit('cancel')" />
      <Button type="button" :label="confirmLabel" :severity="destructive ? 'danger' : 'primary'" @click="emit('confirm')" />
    </div>
  </Dialog>
</template>
