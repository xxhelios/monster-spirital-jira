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
}

export const starterTasks: Task[] = [
  { id: 'ORB-101', title: 'Map out the onboarding flow', description: 'Make the first experience feel effortless for new users.', status: 'To do', priority: 'High', assignee: 'Alex Morgan', label: 'Design' },
  { id: 'ORB-102', title: 'Audit the current dashboard', description: 'Review the existing experience and capture opportunities.', status: 'To do', priority: 'Medium', assignee: 'Sam Lee', label: 'Research' },
  { id: 'ORB-103', title: 'Write project documentation', description: 'Give the team a clear place to get started.', status: 'To do', priority: 'Low', assignee: 'Jordan Kim', label: 'Content' },
  { id: 'ORB-104', title: 'Design the new workspace', description: 'Explore a cleaner home for all our projects.', status: 'In progress', priority: 'High', assignee: 'Alex Morgan', label: 'Design' },
  { id: 'ORB-105', title: 'Build reusable components', description: 'Create the building blocks for a consistent experience.', status: 'In progress', priority: 'Medium', assignee: 'Jordan Kim', label: 'Development' },
  { id: 'ORB-106', title: 'Kick off the project', description: 'Align on goals, milestones, and how we work together.', status: 'Done', priority: 'Medium', assignee: 'Sam Lee', label: 'Planning' },
  { id: 'ORB-107', title: 'Collect early feedback', description: 'Bring the team together and share first impressions.', status: 'Done', priority: 'Low', assignee: 'Alex Morgan', label: 'Research' },
];

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return typeof task.id === 'string' && typeof task.title === 'string' &&
    typeof task.description === 'string' && typeof task.assignee === 'string' &&
    typeof task.label === 'string' && statuses.some((status) => status === task.status) &&
    priorities.some((priority) => priority === task.priority);
}

export function parseTasks(value: string): Task[] {
  const data: unknown = JSON.parse(value);
  if (!Array.isArray(data) || !data.every(isTask) || new Set(data.map((task) => task.id)).size !== data.length) {
    throw new Error('Invalid saved board');
  }
  return data;
}
