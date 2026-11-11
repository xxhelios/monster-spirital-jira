<script setup lang="ts">
import { computed } from 'vue';
import Select from 'primevue/select';

const props = defineProps<{
  modelValue: string;
  users: string[];
  label: string;
  inputId?: string;
  labelledby?: string;
  disabled?: boolean;
  loading?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  refresh: [];
}>();

const options = computed(() => {
  const users = props.users.map((username) => ({ label: username, value: username }));
  if (props.modelValue && !props.users.includes(props.modelValue)) {
    users.unshift({ label: `${props.modelValue} (existing assignment)`, value: props.modelValue });
  }
  return [{ label: 'Unassigned', value: '' }, ...users];
});
</script>

<template>
  <Select
    :model-value="modelValue"
    :options="options"
    :input-id="inputId"
    :aria-label="labelledby ? undefined : label"
    :aria-labelledby="labelledby"
    :disabled="disabled"
    :loading="loading"
    option-label="label"
    option-value="value"
    filter
    filter-placeholder="Search team members"
    :filter-input-props="{ 'aria-label': 'Search team members' }"
    empty-filter-message="No matching team members."
    @before-show="emit('refresh')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #value>
      {{ modelValue || 'Unassigned' }}
    </template>
  </Select>
</template>
