export type EmailProvider =
  | "ses"
  | "smtp"
  | "gmail_smtp"
  | "zoho_smtp"
  | "outlook_smtp";

export const PROVIDER_CONFIG = {
  ses: {
    label: "Amazon SES",
    recommended: true,
    badge: "RECOMMENDED",
    description: "Best deliverability. No port issues. Scales to any volume.",
    riskLevel: "low",
    setupType: "api", // api-key based, no SMTP ports
    requiredFields: [
      {
        key: "sesFromEmail",
        label: "From Email",
        type: "email",
        required: true,
      },
      { key: "sesReplyTo", label: "Reply To", type: "email", required: false },
      { key: "sesDomain", label: "Domain", type: "text", required: true },
      {
        key: "emailFromName",
        label: "Sender Name",
        type: "text",
        required: true,
      },
    ],
    warningMessage: null,
  },
  smtp: {
    label: "Custom SMTP",
    recommended: false,
    badge: "HIGH RISK",
    description:
      "SMTP ports are blocked on most cloud hosts. Use only for local/on-premise.",
    riskLevel: "high",
    setupType: "smtp",
    requiredFields: [
      { key: "smtpHost", label: "SMTP Host", type: "text", required: true },
      { key: "smtpPort", label: "SMTP Port", type: "number", required: true },
      {
        key: "smtpUser",
        label: "SMTP Username",
        type: "email",
        required: true,
      },
      {
        key: "smtpPass",
        label: "SMTP Password",
        type: "password",
        required: true,
      },
      {
        key: "smtpFromEmail",
        label: "From Email",
        type: "email",
        required: true,
      },
      {
        key: "smtpFromName",
        label: "Sender Name",
        type: "text",
        required: true,
      },
      {
        key: "smtpSecure",
        label: "Use SSL/TLS",
        type: "boolean",
        required: false,
      },
    ],
    warningMessage:
      "SMTP port 587/465 is blocked on Render, Railway, and most cloud hosts. High failure rate expected. Switch to Amazon SES for reliable delivery.",
  },
  gmail_smtp: {
    label: "Gmail SMTP",
    recommended: false,
    badge: "LIMITED",
    description:
      "500 emails/day limit. Requires App Password. Often blocked on cloud.",
    riskLevel: "medium",
    setupType: "smtp",
    requiredFields: [
      {
        key: "smtpUser",
        label: "Gmail Address",
        type: "email",
        required: true,
      },
      {
        key: "smtpPass",
        label: "App Password",
        type: "password",
        required: true,
      },
      {
        key: "smtpFromName",
        label: "Sender Name",
        type: "text",
        required: true,
      },
    ],
    warningMessage:
      "Gmail SMTP has a 500/day limit and is blocked on many cloud providers. Not suitable for production.",
  },
  zoho_smtp: {
    label: "Zoho SMTP",
    recommended: false,
    badge: "PORT RISK",
    description:
      "Zoho SMTP uses port 587 which is blocked on cloud hosting providers.",
    riskLevel: "high",
    setupType: "smtp",
    requiredFields: [
      { key: "smtpUser", label: "Zoho Email", type: "email", required: true },
      {
        key: "smtpPass",
        label: "Zoho Password",
        type: "password",
        required: true,
      },
      {
        key: "smtpFromName",
        label: "Sender Name",
        type: "text",
        required: true,
      },
      {
        key: "smtpFromEmail",
        label: "From Email",
        type: "email",
        required: true,
      },
    ],
    warningMessage:
      "Zoho SMTP port 587 is blocked on Render and Railway. Use Amazon SES instead.",
  },
  outlook_smtp: {
    label: "Outlook SMTP",
    recommended: false,
    badge: "PORT RISK",
    description: "Outlook SMTP has port restrictions and OAuth2 enforcement.",
    riskLevel: "high",
    setupType: "smtp",
    requiredFields: [
      {
        key: "smtpUser",
        label: "Outlook Email",
        type: "email",
        required: true,
      },
      { key: "smtpPass", label: "Password", type: "password", required: true },
      {
        key: "smtpFromName",
        label: "Sender Name",
        type: "text",
        required: true,
      },
    ],
    warningMessage:
      "Microsoft is enforcing OAuth2. Basic auth may stop working. Use Amazon SES.",
  },
} as const;

export function getProviderConfig(provider: EmailProvider) {
  return PROVIDER_CONFIG[provider];
}

export function getRequiredFields(provider: EmailProvider) {
  return PROVIDER_CONFIG[provider].requiredFields;
}
