export interface NamedRef {
  id: number;
  name: string;
}

export interface CustomField {
  id: number;
  name: string;
  value: string | string[] | null;
}

// Campo editável extraído do formulário HTML da issue (para o popup de obrigatórios).
export interface EditField {
  id: string;
  label: string;
  type: 'select' | 'multiselect' | 'date' | 'textarea' | 'text' | 'number' | 'bool';
  options?: { value: string; label: string }[];
  kind: 'standard' | 'custom';
  cfId?: number; // quando kind === 'custom'
  name?: string; // quando kind === 'standard' (ex.: 'estimated_hours')
}

export interface JournalDetail {
  property: string;
  name: string;
  old_value: string | null;
  new_value: string | null;
}

export interface Journal {
  id: number;
  user: NamedRef;
  notes: string;
  created_on: string;
  details: JournalDetail[];
}

export interface Attachment {
  id: number;
  filename: string;
  filesize: number;
  content_type: string;
  content_url: string;
  description?: string;
}

export interface IssueChild {
  id: number;
  subject: string;
  tracker: NamedRef;
  status?: NamedRef;
}

export interface IssueRelation {
  id: number;
  issue_id: number;
  issue_to_id: number;
  relation_type: string;
}

export interface Issue {
  id: number;
  subject: string;
  description: string;
  status: IssueStatus;
  priority: NamedRef;
  project: NamedRef;
  tracker: NamedRef;
  assigned_to?: NamedRef;
  author: NamedRef;
  fixed_version?: NamedRef;
  done_ratio: number;
  estimated_hours?: number | null;
  spent_hours?: number;
  due_date?: string;
  start_date?: string;
  created_on: string;
  updated_on: string;
  closed_on?: string;
  journals?: Journal[];
  custom_fields?: CustomField[];
  allowed_statuses?: NamedRef[];
  parent?: { id: number };
  children?: IssueChild[];
  relations?: IssueRelation[];
  watchers?: NamedRef[];
  attachments?: Attachment[];
}

export interface Mention {
  journalId: number;
  issue: { id: number; subject: string; project?: NamedRef };
  author?: NamedRef;
  snippet: string;
  created_on: string;
}

export interface Version {
  id: number;
  name: string;
  status: 'open' | 'locked' | 'closed';
  due_date?: string;
  description?: string;
}

export interface TimeEntryActivity {
  id: number;
  name: string;
  is_default: boolean;
}

export interface TimeEntry {
  id: number;
  project: NamedRef;
  issue?: { id: number };
  user: NamedRef;
  activity: NamedRef;
  hours: number;
  comments: string;
  spent_on: string;
  created_on: string;
  updated_on: string;
}

export interface IssueStatus {
  id: number;
  name: string;
  is_closed: boolean;
}

export interface Project {
  id: number;
  name: string;
  identifier: string;
  status: number;
}

export interface Tracker {
  id: number;
  name: string;
}

export interface Priority {
  id: number;
  name: string;
  is_default: boolean;
}

export interface CurrentUser {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
  mail: string;
}
