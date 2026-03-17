import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { logger } from "@lib/logger";
import { getSesClient } from "@/config/ses";

/**
 * 1. sendViaSES
 */
export async function sendViaSES(options: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
}): Promise<{ messageId: string }> {
  const client = getSesClient();

  logger.info({
    module: "SesProvider",
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    msg: "Sending via SES",
  });

  try {
    const command = new SendEmailCommand({
      FromEmailAddress: options.from,
      Destination: {
        ToAddresses: Array.isArray(options.to) ? options.to : [options.to],
        CcAddresses: options.cc
          ? Array.isArray(options.cc)
            ? options.cc
            : [options.cc]
          : undefined,
        BccAddresses: options.bcc
          ? Array.isArray(options.bcc)
            ? options.bcc
            : [options.bcc]
          : undefined,
      },
      ReplyToAddresses: options.replyTo ? [options.replyTo] : [],
      Content: {
        Simple: {
          Subject: { Data: options.subject },
          Body: {
            Html: { Data: options.html },
            Text: options.text ? { Data: options.text } : undefined,
          },
        },
      },
      ConfigurationSetName: undefined, // Could be used for tracking
      ListManagementOptions: undefined,
    });

    if (options.headers) {
      command.input.Content!.Simple!.Headers = Object.entries(
        options.headers,
      ).map(([Name, Value]) => ({ Name, Value }));
    }

    const response = await client.send(command);
    if (!response.MessageId) {
      throw new Error("Failed to send email via SES: No MessageId returned");
    }

    logger.info({
      module: "SesProvider",
      messageId: response.MessageId,
      msg: "SES send success",
    });

    return { messageId: response.MessageId };
  } catch (err: any) {
    logger.error({
      module: "SesProvider",
      err: err.message,
      msg: "SES send failed",
    });
    throw err;
  }
}

/**
 * 2. createDomainIdentity
 */
export async function createDomainIdentity(domain: string): Promise<{
  dnsRecords: Array<{
    type: string;
    name: string;
    value: string;
    description?: string;
  }>;
}> {
  const client = getSesClient();

  logger.info({
    module: "SesProvider",
    domain,
    msg: "Creating SES identity",
  });

  try {
    // No MailFromAttributes — simplest setup, no MX record required
    const command = new CreateEmailIdentityCommand({
      EmailIdentity: domain,
      DkimSigningAttributes: {
        DomainSigningAttributesOrigin: "AWS_SES",
        NextSigningKeyLength: "RSA_2048_BIT",
      },
    });

    const response = await client.send(command);
    const tokens = response.DkimAttributes?.Tokens || [];

    const dnsRecords: Array<{
      type: string;
      name: string;
      value: string;
      description?: string;
    }> = tokens.map((token) => ({
      type: "CNAME",
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      description: "DKIM signature record",
    }));

    // Always append DMARC — required by AWS SES recommendations
    dnsRecords.push({
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: '"v=DMARC1; p=none;"',
      description: "DMARC policy — required for email authentication",
    });

    logger.info({
      module: "SesProvider",
      domain,
      recordCount: dnsRecords.length,
      msg: "SES identity created",
    });

    return { dnsRecords };
  } catch (err: any) {
    logger.error({
      module: "SesProvider",
      domain,
      err: err.message,
      msg: "Identity creation failed",
    });
    throw err;
  }
}

/**
 * 3. getDomainVerificationStatus
 */
export async function getDomainVerificationStatus(domain: string): Promise<{
  verified: boolean;
  dkimStatus: string;
  mailFromStatus: string;
}> {
  const client = getSesClient();

  const command = new GetEmailIdentityCommand({
    EmailIdentity: domain,
  });

  const response = await client.send(command);
  const verified = response.VerifiedForSendingStatus || false;

  logger.info({
    module: "SesProvider",
    domain,
    verified,
    msg: "Domain verification checked",
  });

  return {
    verified,
    dkimStatus: response.DkimAttributes?.Status || "NOT_STARTED",
    mailFromStatus:
      response.MailFromAttributes?.MailFromDomainStatus || "NOT_STARTED",
  };
}

/**
 * 4. deleteDomainIdentity
 */
export async function deleteDomainIdentity(domain: string): Promise<void> {
  const client = getSesClient();

  const command = new DeleteEmailIdentityCommand({
    EmailIdentity: domain,
  });

  await client.send(command);

  logger.info({
    module: "SesProvider",
    domain,
    msg: "SES identity deleted",
  });
}
