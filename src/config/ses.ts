import { SESv2Client } from "@aws-sdk/client-sesv2";

// Only initialize if env vars present
// Do NOT throw at module level — some tenants use SMTP
let _sesClient: SESv2Client | null = null;

export function getSesClient(): SESv2Client {
  if (!process.env.AWS_SES_ACCESS_KEY || !process.env.AWS_SES_SECRET_KEY) {
    throw new Error(
      "AWS SES not configured. Add AWS_SES_ACCESS_KEY and AWS_SES_SECRET_KEY to environment.",
    );
  }
  if (!_sesClient) {
    _sesClient = new SESv2Client({
      region: process.env.AWS_SES_REGION || "ap-south-1",
      credentials: {
        accessKeyId: process.env.AWS_SES_ACCESS_KEY as string,
        secretAccessKey: process.env.AWS_SES_SECRET_KEY as string,
      },
    });
  }
  return _sesClient;
}
