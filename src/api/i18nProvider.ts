import { i18nProvider as baseProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";

const overrides: Record<string, string> = {
  "crm.auth.welcome_title": "Welcome to CARE AI CRM",
  "crm.auth.install": "Install CARE AI CRM",
};

export const careI18nProvider = {
  ...baseProvider,
  translate: (key: string, options?: object) => {
    if (key in overrides) return overrides[key];
    return baseProvider.translate(key, options);
  },
};
