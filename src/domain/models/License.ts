export type LicenseTier = 'free' | 'pro';

export type ProFeatureId =
  | 'organize-vault'
  | 'auto-maintenance';

export interface LicenseStatus {
  readonly tier: LicenseTier;
  readonly licenseKey: string | null;
  readonly validatedAt: number | null;
  readonly errorMessage: string | null;
}

export const PRO_FEATURES: ReadonlyArray<{
  readonly id: ProFeatureId;
  readonly i18nKey: string;
}> = [
  { id: 'organize-vault', i18nKey: 'pro.organizeVault' },
  { id: 'auto-maintenance', i18nKey: 'pro.autoMaintenance' },
];
