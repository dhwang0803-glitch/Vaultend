import type { MaintenanceIssueType } from '../models/MaintenanceAction';

export type SeverityLevel = 'critical' | 'warning' | 'info';

export const ISSUE_SEVERITY: Record<MaintenanceIssueType, SeverityLevel> = {
  'broken-link': 'critical',
  'empty': 'critical',
  'orphan': 'warning',
  'duplicate': 'warning',
  'untagged': 'info',
  'missing-tags': 'info',
  'duplicate-tags': 'info',
};

export const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function getSeverity(issueType: MaintenanceIssueType): SeverityLevel {
  return ISSUE_SEVERITY[issueType];
}
