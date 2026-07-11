import { describe, it, expect } from 'vitest';
import { getSeverity, ISSUE_SEVERITY, SEVERITY_ORDER } from '../Severity';
import type { MaintenanceIssueType } from '../../models/MaintenanceAction';

describe('Severity', () => {
  describe('ISSUE_SEVERITY', () => {
    it('maps all 6 issue types', () => {
      const types: MaintenanceIssueType[] = [
        'orphan', 'broken-link', 'missing-tags', 'duplicate', 'empty', 'untagged',
      ];
      for (const type of types) {
        expect(ISSUE_SEVERITY[type]).toBeDefined();
      }
    });

    it('classifies broken-link and empty as critical', () => {
      expect(ISSUE_SEVERITY['broken-link']).toBe('critical');
      expect(ISSUE_SEVERITY['empty']).toBe('critical');
    });

    it('classifies orphan and duplicate as warning', () => {
      expect(ISSUE_SEVERITY['orphan']).toBe('warning');
      expect(ISSUE_SEVERITY['duplicate']).toBe('warning');
    });

    it('classifies untagged and missing-tags as info', () => {
      expect(ISSUE_SEVERITY['untagged']).toBe('info');
      expect(ISSUE_SEVERITY['missing-tags']).toBe('info');
    });
  });

  describe('getSeverity()', () => {
    it('returns the correct severity for each type', () => {
      expect(getSeverity('broken-link')).toBe('critical');
      expect(getSeverity('orphan')).toBe('warning');
      expect(getSeverity('untagged')).toBe('info');
    });
  });

  describe('SEVERITY_ORDER', () => {
    it('orders critical < warning < info', () => {
      expect(SEVERITY_ORDER['critical']).toBeLessThan(SEVERITY_ORDER['warning']);
      expect(SEVERITY_ORDER['warning']).toBeLessThan(SEVERITY_ORDER['info']);
    });
  });
});
