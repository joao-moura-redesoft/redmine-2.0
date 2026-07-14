import { createAuthedClient } from './client';

const api = createAuthedClient();

export interface FlowStatus {
  status: string;
  count: number;
  stuck: number;
  avgAge: number;
}

export interface AgingIssue {
  id: number;
  subject: string;
  status: string;
  assignee: string | null;
  priority: string | null;
  project: string | null;
  days: number;
}

export interface FlowAnalytics {
  totalOpen: number;
  capped: boolean;
  thresholds: { watch: number; stuck: number };
  buckets: { fresh: number; watch: number; stuck: number };
  statusDistribution: FlowStatus[];
  agingList: AgingIssue[];
  stuckByAssignee: { name: string; count: number }[];
  cycle: { count: number; avg: number | null; median: number | null };
  oldest: number;
  generatedAt: number;
}

export async function getFlowAnalytics(projectId?: number): Promise<FlowAnalytics> {
  const { data } = await api.get<FlowAnalytics>('/analytics/flow', {
    params: projectId ? { project_id: projectId } : {},
  });
  return data;
}

export interface TrendMonth {
  key: string;
  created: number;
  closed: number;
  net: number;
  backlog: number;
}

export interface TrendsAnalytics {
  months: TrendMonth[];
  monthsBack: number;
  totalOpenNow: number;
  capped: boolean;
  summary: {
    createdTotal: number;
    closedTotal: number;
    netTotal: number;
    avgCreated: number;
    avgClosed: number;
    backlogStart: number;
    backlogEnd: number;
    backlogDelta: number;
    trend: 'growing' | 'shrinking' | 'stable';
  };
  generatedAt: number;
}

export async function getTrendsAnalytics(
  projectId?: number,
  months?: number,
): Promise<TrendsAnalytics> {
  const { data } = await api.get<TrendsAnalytics>('/analytics/trends', {
    params: {
      ...(projectId ? { project_id: projectId } : {}),
      ...(months ? { months } : {}),
    },
  });
  return data;
}

export interface SlaOverdueIssue {
  id: number;
  subject: string;
  assignee: string | null;
  project: string | null;
  due_date: string;
  daysOverdue: number;
}

export interface SlaUpcomingIssue {
  id: number;
  subject: string;
  due_date: string;
  daysUntil: number;
}

export interface SlaUpcomingGroup {
  name: string;
  count: number;
  issues: SlaUpcomingIssue[];
}

export interface SlaAnalytics {
  open: {
    total: number;
    withDue: number;
    overdue: number;
    dueToday: number;
    dueSoon: number;
    avgOverdueDays: number;
  };
  delivery: {
    closedWithDue: number;
    onTime: number;
    late: number;
    rate: number | null;
    avgLateDays: number;
  };
  overdueList: SlaOverdueIssue[];
  upcoming: SlaUpcomingGroup[];
  byAssigneeOverdue: { name: string; count: number }[];
  horizon: number;
  capped: boolean;
  window: { days: number; horizon: number };
  generatedAt: number;
}

export async function getSlaAnalytics(
  projectId?: number,
  opts?: { horizon?: number; days?: number },
): Promise<SlaAnalytics> {
  const { data } = await api.get<SlaAnalytics>('/analytics/sla', {
    params: {
      ...(projectId ? { project_id: projectId } : {}),
      ...(opts?.horizon ? { horizon: opts.horizon } : {}),
      ...(opts?.days ? { days: opts.days } : {}),
    },
  });
  return data;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface ProjectTracker {
  name: string;
  open: number;
  closed: number;
  total: number;
}

export interface ProjectVersion {
  id: number;
  name: string;
  status: 'open' | 'locked' | 'closed';
  due_date: string | null;
  total: number;
  closed: number;
  open: number;
  pct: number;
  overdue: boolean;
}

export interface ProjectOpenIssue {
  id: number;
  subject: string;
  status: string;
  tracker: string;
  priority: string;
  assignee: string;
}

export interface ProjectAnalytics {
  project_id: number;
  totals: { total: number; open: number; closed: number; completion: number };
  byStatus: NameCount[];
  byTracker: ProjectTracker[];
  byPriority: NameCount[];
  byAssignee: NameCount[];
  versions: ProjectVersion[];
  openList: ProjectOpenIssue[];
  capped: boolean;
  generatedAt: number;
}

export async function getProjectAnalytics(projectId: number): Promise<ProjectAnalytics> {
  const { data } = await api.get<ProjectAnalytics>('/analytics/project', {
    params: { project_id: projectId },
  });
  return data;
}

export interface MeIssueRef {
  id: number;
  subject: string;
  status: string;
  due_date: string | null;
}

export interface MeKpi {
  count: number;
  issues: MeIssueRef[];
}

export interface MeAnalytics {
  weeks: { key: string; closed: number }[];
  kpis: {
    open: MeKpi;
    inProgress: MeKpi;
    overdue: MeKpi;
    completed: MeKpi;
  };
  cycle: { count: number; avg: number | null; median: number | null };
  onTime: {
    closedWithDue: number;
    onTime: number;
    late: number;
    rate: number | null;
    avgLateDays: number;
  };
  days: number;
  capped: boolean;
  generatedAt: number;
}

export async function getMeAnalytics(days?: number): Promise<MeAnalytics> {
  const { data } = await api.get<MeAnalytics>('/analytics/me', {
    params: { ...(days ? { days } : {}) },
  });
  return data;
}
