import { type Response, Router } from "express";
import { PROVIDER_CONFIG } from "../../config/emailProviders.ts";
import {
  type AuthRequest,
  validateClientKey,
} from "../../middleware/saasAuth.ts";
import { emailConfigService } from "../../services/mail/EmailConfigService.ts";
import { emailHealthService } from "../../services/mail/EmailHealthService.ts";

const router = Router();

/**
 * GET /api/settings/email
 * Get current config + health
 */
router.get("/", validateClientKey, async (req: AuthRequest, res: Response) => {
  try {
    const config = await emailConfigService.getConfig(req.clientCode!);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/settings/email/provider
 * Switch provider
 */
router.post(
  "/provider",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { provider } = req.body;
      if (!provider)
        return res.status(400).json({ error: "Provider is required" });

      const result = await emailConfigService.switchProvider(
        req.clientCode!,
        provider,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/settings/email/smtp
 * Save SMTP config
 */
router.post(
  "/smtp",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await emailConfigService.saveSmtpConfig(
        req.clientCode!,
        req.body,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/settings/email/ses/domain
 * Initialize domain verification (Step 1)
 */
router.post(
  "/ses/domain",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ error: "Domain is required" });

      const result = await emailConfigService.initDomainVerification(
        req.clientCode!,
        domain,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/settings/email/ses/config
 * Save email config (Step 3)
 */
router.post(
  "/ses/config",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { fromName, fromEmail, replyTo } = req.body;
      if (!fromName || !fromEmail) {
        return res
          .status(400)
          .json({ error: "From Name and From Email are required" });
      }

      const result = await emailConfigService.saveEmailConfig(req.clientCode!, {
        fromName,
        fromEmail,
        replyTo,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * GET /api/settings/email/ses/verify
 * Check SES verification
 */
router.get(
  "/ses/verify",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await emailConfigService.checkSesVerification(
        req.clientCode!,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * DELETE /api/settings/email/ses/domain
 * Remove SES identity
 */
router.delete(
  "/ses/domain",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      await emailConfigService.removeSesIdentity(req.clientCode!);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/settings/email/test
 * Send test email
 */
router.post(
  "/test",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { toEmail } = req.body;
      if (!toEmail)
        return res.status(400).json({ error: "Recipient email is required" });

      const result = await emailConfigService.sendTestEmail(
        req.clientCode!,
        toEmail,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/settings/email/advanced
 * Save advanced marketing config (CC, BCC, Footer, Limit)
 */
router.post(
  "/advanced",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await emailConfigService.saveAdvancedConfig(
        req.clientCode!,
        req.body,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * GET /api/settings/email/health
 * Get health summary
 */
router.get(
  "/health",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const health = await emailHealthService.getHealthSummary(req.clientCode!);
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/settings/email/ses/fix-dmarc
 * Migration: append DMARC record for existing clients
 */
router.post(
  "/ses/fix-dmarc",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await emailConfigService.addMissingDmarcRecord(
        req.clientCode!,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * GET /api/settings/email/providers
 * List providers (no secrets)
 */
router.get("/providers", (_req, res) => {
  res.json(PROVIDER_CONFIG);
});

export default router;
