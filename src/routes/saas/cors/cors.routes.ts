import express from "express";
import { dbConnect } from "@/lib/config";
import { verifyCoreToken } from "@/middleware/auth";
import { CorsOrigin } from "@/model/cors-origin.model";
import { refreshOriginsCache } from "@/model/cors-origins";

const router = express.Router();

// All routes here require Core API Key for high-level management
/**
 * @module Routes/CORS
 * @responsibility Dynamic whitelist management for cross-origin requests.
 *
 * **GOAL:** Provide an administrative interface to manage which external domains (client frontends, third-party widgets) are allowed to hit the API.
 *
 * **DETAILED EXECUTION:**
 * 1. **Security Policy**: Enforces `verifyCoreToken` for all operations, as this controls the entire system's security perimeter.
 * 2. **Cache Synchronization**: Every mutation (`POST`, `PATCH`, `DELETE`) triggers `refreshOriginsCache()` to ensure the `isOriginAllowed` middleware has zero-latency access to the updated whitelist.
 */
router.use(verifyCoreToken);

/**
 * GET /api/saas/cors
 * List all CORS origins registered in the database.
 */
router.get("/", async (_req, res) => {
  try {
    await dbConnect("saas");
    const origins = await CorsOrigin.find().sort({ createdAt: -1 });
    res.json({ success: true, data: origins });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/saas/cors
 * Add a new CORS origin.
 */
router.post("/", async (req, res) => {
  try {
    const { url, name, allowedHeaders, allowedMethods } = req.body;
    if (!url) {
      return res
        .status(400)
        .json({ success: false, error: "Origin URL is required" });
    }

    await dbConnect("saas");
    const origin = await CorsOrigin.create({
      url: url.toLowerCase().trim(),
      name,
      allowedHeaders: allowedHeaders || undefined,
      allowedMethods: allowedMethods || undefined,
    });

    // Invalidate cache immediately to apply changes
    refreshOriginsCache();

    res.json({ success: true, data: origin });
  } catch (error: any) {
    if ((error as any).code === 11000) {
      return res
        .status(400)
        .json({ success: false, error: "This origin URL already exists" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/saas/cors/:id
 * Update an existing origin or toggle its active status.
 */
router.patch("/:id", async (req, res) => {
  try {
    await dbConnect("saas");
    const origin = await CorsOrigin.findByIdAndUpdate(req.params.id, req.body, {
      returnDocument: "after",
    });

    if (!origin) {
      return res
        .status(404)
        .json({ success: false, error: "CORS origin not found" });
    }

    refreshOriginsCache();
    res.json({ success: true, data: origin });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/saas/cors/:id
 * Remove a CORS origin record from the database.
 */
router.delete("/:id", async (req, res) => {
  try {
    await dbConnect("saas");
    const origin = await CorsOrigin.findByIdAndDelete(req.params.id);

    if (!origin) {
      return res
        .status(404)
        .json({ success: false, error: "CORS origin not found" });
    }

    refreshOriginsCache();
    res.json({ success: true, message: "CORS origin deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
