import nodemailer from "nodemailer";

/**
 * 1. sendViaSMTP
 */
export async function sendViaSMTP(options: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
  smtpConfig: {
    host: string;
    port: number;
    user: string;
    pass: string;
    secure: boolean;
  };
}): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: options.smtpConfig.host,
    port: options.smtpConfig.port,
    secure: options.smtpConfig.secure,
    auth: {
      user: options.smtpConfig.user,
      pass: options.smtpConfig.pass,
    },
    connectionTimeout: 10000, // 10s
    greetingTimeout: 5000, // 5s
  });

  try {
    // Verify before sending
    await transporter.verify();

    const info = await transporter.sendMail({
      from: options.from,
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo,
      subject: options.subject,
      text: options.text,
      html: options.html,
      headers: options.headers,
    });

    return { messageId: info.messageId };
  } catch (err: any) {
    if (err.code === "ETIMEDOUT") {
      throw new Error(
        "SMTP connection timeout. Port may be blocked by hosting provider.",
      );
    }
    if (err.code === "ECONNREFUSED") {
      throw new Error("SMTP connection refused. Check host and port.");
    }
    if (err.code === "EAUTH") {
      throw new Error(
        "SMTP authentication failed. Check username and password.",
      );
    }
    throw err;
  } finally {
    transporter.close();
  }
}

/**
 * 2. testSmtpConnection
 */
export async function testSmtpConnection(smtpConfig: {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  latencyMs?: number;
}> {
  const start = Date.now();
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
    connectionTimeout: 5000,
  });

  try {
    await transporter.verify();
    const latencyMs = Date.now() - start;
    return { success: true, latencyMs };
  } catch (err: any) {
    let error = err.message;
    if (err.code === "ETIMEDOUT") error = "SMTP connection timeout.";
    if (err.code === "ECONNREFUSED") error = "SMTP connection refused.";
    if (err.code === "EAUTH") error = "SMTP authentication failed.";

    return { success: false, error };
  } finally {
    transporter.close();
  }
}
