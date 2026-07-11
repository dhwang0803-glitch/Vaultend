import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, getLocale, formatDate } from '../index';

describe('i18n', () => {
  beforeEach(() => {
    setLocale('en');
  });

  describe('t()', () => {
    it('returns English text by default', () => {
      expect(t('maintenance.viewTitle')).toBe('Vault Maintenance');
    });

    it('returns Korean text when locale is ko', () => {
      setLocale('ko');
      expect(t('maintenance.viewTitle')).toBe('Vault 유지보수');
    });

    it('interpolates {{param}} placeholders', () => {
      const result = t('notice.clipboardSaved', { path: 'test.md' });
      expect(result).toBe('Clipboard saved: test.md');
    });

    it('interpolates multiple params', () => {
      const result = t('notice.inboxComplete', { processed: 5, skipped: 2, errors: 1 });
      expect(result).toBe('Inbox complete: 5 processed, 2 skipped, 1 errors');
    });

    it('preserves unmatched placeholders', () => {
      const result = t('notice.clipboardSaved');
      expect(result).toBe('Clipboard saved: {{path}}');
    });

    it('falls back to English for missing Korean keys', () => {
      setLocale('ko');
      expect(t('plugin.name')).toBe('Knowledge Maintenance');
    });
  });

  describe('setLocale / getLocale', () => {
    it('changes locale', () => {
      setLocale('ko');
      expect(getLocale()).toBe('ko');
      setLocale('en');
      expect(getLocale()).toBe('en');
    });
  });

  describe('formatDate', () => {
    it('formats date in English locale', () => {
      setLocale('en');
      const result = formatDate(1700000000000);
      expect(result).toContain('2023');
    });

    it('formats date in Korean locale', () => {
      setLocale('ko');
      const result = formatDate(1700000000000);
      expect(result).toContain('2023');
    });
  });
});
