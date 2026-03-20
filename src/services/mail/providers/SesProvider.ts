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
 *
 * **WORKING PROCESS:**
 * 1. Initialization: Connects to the global services database and fetches all clients belonging to the specified agency.
 * 2. Parallel Aggregation: Uses `Promise.all` to concurrently process each client, calculating key metrics such as total leads, total pipeline value, won deals count, and won deals value.
 * 3. Error Handling: Implements a `try-catch` block for each client to prevent a single client's data issues from affecting the entire aggregation.
 * 4. Portfolio Summary: Calculates the grand totals for the entire portfolio by summing the metrics from all individual clients.
 *
 * **EDGE CASES:**
 * - Empty Agency: If no clients are found for the given agency code, it returns an empty breakdown and zeroed-out portfolio totals.
 * - Data Corruption: If a specific client's database connection fails or aggregation errors occur, that client is skipped, and an error is logged, allowing the service to continue processing other clients.
 * - No Won Deals: If no deals are marked as "won" across all clients, the conversion rate correctly defaults to 0%.
 *
 * @param {object} options - The email options.
 * @param {string|string[]} options.to - The recipient email address(es).
 * @param {string} options.subject - The email subject.
 * @param {string} options.html - The email HTML content.
 * @param {string} [options.text] - The email text content.
 * @param {string} options.from - The sender email address.
 * @param {string} [options.replyTo] - The reply-to email address.
 * @param {string|string[]} [options.cc] - The CC email address(es).
 * @param {string|string[]} [options.bcc] - The BCC email address(es).
 * @param {Record<string, string>} [options.headers] - The email headers.
 * @returns {Promise<{ messageId: string }>} The message ID.
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
 *
 * **WORKING PROCESS:**
 * 1. Initialization: Connects to the global services database and fetches all clients belonging to the specified agency.
 * 2. Parallel Aggregation: Uses `Promise.all` to concurrently process each client, calculating key metrics such as total leads, total pipeline value, won deals count, and won deals value.
 * 3. Error Handling: Implements a `try-catch` block for each client to prevent a single client's data issues from affecting the entire aggregation.
 * 4. Portfolio Summary: Calculates the grand totals for the entire portfolio by summing the metrics from all individual clients.
 *
 * **EDGE CASES:**
 * - Empty Agency: If no clients are found for the given agency code, it returns an empty breakdown and zeroed-out portfolio totals.
 * - Data Corruption: If a specific client's database connection fails or aggregation errors occur, that client is skipped, and an error is logged, allowing the service to continue processing other clients.
 * - No Won Deals: If no deals are marked as "won" across all clients, the conversion rate correctly defaults to 0%.
 *
 * @param {object} options - The email options.
 * @param {string|string[]} options.to - The recipient email address(es).
 * @param {string} options.subject - The email subject.
 * @param {string} options.html - The email HTML content.
 * @param {string} [options.text] - The email text content.
 * @param {string} options.from - The sender email address.
 * @param {string} [options.replyTo] - The reply-to email address.
 * @param {string|string[]} [options.cc] - The CC email address(es).
 * @param {string|string[]} [options.bcc] - The BCC email address(es).
 * @param {Record<string, string>} [options.headers] - The email headers.
 * @returns {Promise<{ messageId: string }>} The message ID.
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
