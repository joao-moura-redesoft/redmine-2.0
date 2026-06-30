export interface IssueTemplate {
  id: string;
  name: string;
  subject: string;
  description: string;
  tracker_id?: number;
  priority_id?: number;
}

const KEY = 'issue-templates';

export function getTemplates(): IssueTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as IssueTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplate(t: IssueTemplate): void {
  const all = getTemplates().filter((x) => x.id !== t.id);
  localStorage.setItem(KEY, JSON.stringify([...all, t]));
}

export function deleteTemplate(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(getTemplates().filter((x) => x.id !== id)));
}
