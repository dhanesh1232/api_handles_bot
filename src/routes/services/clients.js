import crypto from "crypto";
import express from "express";

import { verifyCoreToken } from "../../lib/auth.js";
import { dbConnect } from "../../lib/config.js";
import { Client } from "../../model/clients/client.js";
import { ClientServiceConfig } from "../../model/clients/config.js";
import { ClientDataSource } from "../../model/clients/dataSource.js";
import { ClientSecrets } from "../../model/clients/secrets.js";

const router = express.Router();

// 1. GET ALL CLIENTS (Admin / Discovery)
router.get("/clients", async (req, res) => {
  await dbConnect("services");
  try {
    const clients = await Client.find().sort({ createdAt: -1 });
    res
      .status(200)
      .json({ success: true, count: clients.length, data: clients });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 1a. GET SINGLE CLIENT
router.get("/clients/:code", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const client = await Client.findOne({
      clientCode: req.params.code.toUpperCase(),
    });
    if (!client)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    res.status(200).json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 1b. GET CLIENT COUNT
router.get("/clients/count", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const count = await Client.countDocuments();
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. CREATE CLIENT (Admin Only - Auto-creates companion records)
router.post("/clients", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const { name, clientCode, business, plan } = req.body;

    if (!name || !clientCode) {
      return res
        .status(400)
        .json({ success: false, message: "Name and ClientCode are required." });
    }

    const existingClient = await Client.findOne({
      clientCode: clientCode.toUpperCase(),
    });
    if (existingClient) {
      return res
        .status(400)
        .json({ success: false, message: "Client Code already exists." });
    }

    // Create Identity
    const client = await Client.create({
      name,
      clientCode,
      business,
      plan,
      status: "pending",
    });

    // Auto-create ServiceConfig (Empty/Disabled)
    await ClientServiceConfig.create({
      clientCode: client.clientCode,
      clientId: client._id,
    });

    // Auto-create Secrets Holder
    await ClientSecrets.create({
      clientCode: client.clientCode,
      clientId: client._id,
    });

    // Auto-create Data Source placeholder
    // We don't necessarily need to create this if empty, but for consistency:
    // await ClientDataSource.create({ ... });

    res.status(201).json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. GET CLIENT CONFIG (For Execution Engine or Admin)
router.get("/clients/:code/config", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const config = await ClientServiceConfig.findOne({
      clientCode: req.params.code.toUpperCase(),
    });
    if (!config)
      return res
        .status(404)
        .json({ success: false, message: "Config not found" });
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. UPDATE CLIENT CONFIG (Admin Only)
router.patch("/clients/:code/config", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const config = await ClientServiceConfig.findOneAndUpdate(
      { clientCode: req.params.code.toUpperCase() },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. UPDATE SECRETS (Admin Only - Never returned to public)
router.get("/clients/:code/secrets", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const secrets = await ClientSecrets.findOne({
      clientCode: req.params.code.toUpperCase(),
    });
    if (!secrets)
      return res
        .status(404)
        .json({ success: false, message: "Secrets not found" });

    // Decrypt standard fields
    const decrypted = {
      whatsappToken: secrets.getDecrypted("whatsappToken"),
      whatsappInstanceId: secrets.getDecrypted("whatsappInstanceId"),
      whatsappBusinessId: secrets.getDecrypted("whatsappBusinessId"),
      whatsappPhoneNumberId: secrets.getDecrypted("whatsappPhoneNumberId"),
      whatsappWebhookToken: secrets.getDecrypted("whatsappWebhookToken"),
      
      googleClientId: secrets.getDecrypted("googleClientId"),
      googleClientSecret: secrets.getDecrypted("googleClientSecret"),
      googleRefreshToken: secrets.getDecrypted("googleRefreshToken"),

      r2AccessKeyId: secrets.getDecrypted("r2AccessKeyId"),
      r2SecretKey: secrets.getDecrypted("r2SecretKey"),
      r2BucketName: secrets.r2BucketName,
      r2Endpoint: secrets.getDecrypted("r2Endpoint"),
      r2PublicDomain: secrets.r2PublicDomain,

      emailApiKey: secrets.getDecrypted("emailApiKey"),
      emailProvider: secrets.emailProvider,
      automationWebhookSecret: secrets.getDecrypted("automationWebhookSecret"),

      smtpHost: secrets.getDecrypted("smtpHost"),
      smtpPort: secrets.smtpPort,
      smtpUser: secrets.getDecrypted("smtpUser"),
      smtpPass: secrets.getDecrypted("smtpPass"),
      smtpFrom: secrets.getDecrypted("smtpFrom"),
      smtpSecure: secrets.smtpSecure,

      customSecrets: {},
      _id: secrets._id,
      clientCode: secrets.clientCode,
    };

    // Decrypt custom fields
    if (secrets.customSecrets) {
      for (let [key, value] of secrets.customSecrets) {
        decrypted.customSecrets[key] =
          secrets.getDecrypted(`customSecrets.${key}`) ||
          secrets.customSecrets.get(key);
        // Note: getDecrypted logic in model might need fix for deep paths, but model usage of Map is usually direct.
        // Let's assume decrypt works on the raw value for now or fix it in model.
      }
    }

    res.status(200).json({ success: true, data: decrypted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/clients/:code/secrets", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const clientCode = req.params.code.toUpperCase();
    const client = await Client.findOne({ clientCode });

    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    let secrets = await ClientSecrets.findOne({ clientCode });

    if (!secrets) {
      secrets = new ClientSecrets({
        clientCode,
        clientId: client._id,
      });
    }

    // Use set() which is more reliable for Mongoose documents
    // We only update fields present in req.body
    Object.keys(req.body).forEach((key) => {
      secrets.set(key, req.body[key]);
    });

    await secrets.save();

    res
      .status(200)
      .json({ success: true, message: "Secrets updated and encrypted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5a. GET DATA SOURCE (Admin Only)
router.get("/clients/:code/datasource", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const ds = await ClientDataSource.findOne({
      clientCode: req.params.code.toUpperCase(),
    });
    if (!ds) return res.status(200).json({ success: true, data: null });

    const decrypted = {
      ...ds.toObject(),
      dbUri: ds.getUri(), // Decrypt for admin to see/edit
    };

    res.status(200).json({ success: true, data: decrypted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. MANAGE DATA SOURCE (Admin Only)
router.post("/clients/:code/datasource", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const clientCode = req.params.code.toUpperCase();
    const { clientId, ...rest } = req.body;

    let ds = await ClientDataSource.findOne({ clientCode });

    if (!ds) {
      ds = new ClientDataSource({
        clientCode,
        clientId,
      });
    }

    // Update fields
    Object.keys(rest).forEach((key) => {
      // console.log(`Updating ${key}:`, rest[key]);
      ds.set(key, rest[key]);
    });

    if (clientId) ds.clientId = clientId;

    // console.log("Incoming DB URI:", rest.dbUri);
    // console.log("Is DB Modified?", ds.isModified("dbUri"));

    await ds.save(); // This triggers the pre-save encryption hook

    res.status(200).json({ success: true, message: "Data source configured" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 7. UPDATE CLIENT IDENTITY (Status, Name, or Code with cascading updates)
router.patch("/clients/:id/identity", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const { name, clientCode, status, business, plan, whatsapp } = req.body;

    const client = await Client.findById(req.params.id);

    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    const oldCode = client.clientCode;
    const newCode = clientCode ? clientCode.toUpperCase() : oldCode;

    // If changing code, check for conflicts
    if (newCode !== oldCode) {
      const conflict = await Client.findOne({ clientCode: newCode });
      if (conflict) {
        return res
          .status(400)
          .json({ success: false, message: "New client code already in use" });
      }
    }

    // Update the main client record
    if (name) client.name = name;
    if (status) client.status = status;
    if (clientCode) client.clientCode = newCode;
    if (business) client.business = { ...client.business, ...business };
    if (plan) client.plan = { ...client.plan, ...plan };
    if (whatsapp) client.whatsapp = { ...client.whatsapp, ...whatsapp };

    await client.save();

    // Cascading updates if code changed
    if (newCode !== oldCode) {
      await ClientServiceConfig.updateMany(
        { clientCode: oldCode },
        { $set: { clientCode: newCode } },
      );
      await ClientSecrets.updateMany(
        { clientCode: oldCode },
        { $set: { clientCode: newCode } },
      );
      await ClientDataSource.updateMany(
        { clientCode: oldCode },
        { $set: { clientCode: newCode } },
      );
    }

    res.status(200).json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 8. GENERATE API KEY (Admin Only)
router.post("/clients/:code/api-key", verifyCoreToken, async (req, res) => {
  await dbConnect("services");
  try {
    const client = await Client.findOne({
      clientCode: req.params.code.toUpperCase(),
    });

    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    // Generate a secure random key
    const apiKey = `ERIX${crypto.randomBytes(24).toString("hex").toUpperCase()}`;
    client.apiKey = apiKey;
    await client.save();

    res.status(200).json({ success: true, apiKey });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
