export interface DashboardFollowUpItem {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  content: string;
  followUpDate: string;
  userName: string;
}

export interface FollowUpGroups {
  overdue: DashboardFollowUpItem[];
  dueToday: DashboardFollowUpItem[];
  upcoming: DashboardFollowUpItem[];
  total: number;
}