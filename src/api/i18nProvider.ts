import { i18nProvider as baseProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";

const overrides: Record<string, string> = {
  "crm.auth.welcome_title": "Welcome to CARE AI CRM",
  "crm.auth.install": "Install CARE AI CRM",
  "resources.claims.name": "Claim |||| Claims",
  "resources.claims.forcedCaseName": "Claim",
  "resources.policies.name": "Policy |||| Policies",
  "resources.policies.forcedCaseName": "Policy",
  "resources.carriers.name": "Carrier |||| Carriers",
  "resources.carriers.forcedCaseName": "Carrier",
  "resources.carrier_adjusters.name": "Carrier adjuster |||| Carrier adjusters",
  "resources.estimates.name": "Estimate |||| Estimates",
  "resources.settlements.name": "Settlement |||| Settlements",
};

export const careI18nProvider = {
  ...baseProvider,
  translate: (key: string, options?: object) => {
    if (key in overrides) return overrides[key];
    return baseProvider.translate(key, options);
  },
};
