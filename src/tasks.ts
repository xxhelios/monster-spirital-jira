export const statuses = ['To do', 'In progress', 'Done'] as const;
export const priorities = ['Low', 'Medium', 'High'] as const;

export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];

export interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee: string;
  label: string;
  version: number;
}

export type TaskDetails = Omit<Task, 'id' | 'version'>;
