import { getCrmModels } from "@/lib/tenant/crm.models";

/**
 * Built-in system events that are always available for all tenants.
 */
export const SYSTEM_EVENTS = [
  {
    name: "stage_enter",
    displayName: "Lead Enters Stage",
    description: "Fires when a lead is moved into a specific pipeline stage.",
    isSystem: true,
  },
  {
    name: "lead_created",
    displayName: "Lead Created",
    description: "Fires when a new lead is added to the CRM.",
    isSystem: true,
  },
  {
    name: "whatsapp_incoming",
    displayName: "Incoming WhatsApp",
    description: "Fires when a customer sends an unsolicited WhatsApp message.",
    isSystem: true,
  },
  {
    name: "appointment_confirmed",
    displayName: "Appointment Confirmed",
    description: "Fires when a Google Meet or offline appointment is booked.",
    isSystem: true,
  },
  {
    name: "appointment_reminder",
    displayName: "Appointment Reminder",
    description:
      "Fires at configured intervals relative to an appointment start time.",
    isSystem: true,
  },
  {
    name: "tag_added",
    displayName: "Tag Added",
    description: "Fires when a specific tag is attached to a lead.",
    isSystem: true,
  },
];

export const EventDefService = {
  /**
   * Retrieves all active event triggers for a specific tenant.
   *
   * **WORKING PROCESS:**
   * 1. Merges the built-in `SYSTEM_EVENTS` (which are static and immutable).
   * 2. Fetches any custom `CustomEventDef` records created by the tenant.
   * 3. Normalizes the output into a unified schema for UI dropdowns and automation rule matching.
   *
   * @param {string} clientCode - Tenant identifier.
   * @returns {Promise<any[]>} Combined list of system and custom events.
   */
  async getAllEvents(clientCode: string) {
    const { CustomEventDef } = await getCrmModels(clientCode);
    const customEvents = await CustomEventDef.find({
      clientCode,
      isActive: true,
    });

    return [
      ...SYSTEM_EVENTS,
      ...customEvents.map((ev) => ({
        name: ev.name,
        displayName: ev.displayName,
        description: ev.description,
        isSystem: false,
        pipelineId: ev.pipelineId,
        stageId: ev.stageId,
        defaultSource: ev.defaultSource,
      })),
    ];
  },

  /**
   * Registers or updates a custom event trigger for a tenant.
   *
   * **WORKING PROCESS:**
   * 1. Conflict Check: Validates that the event name does not overlap with protected `SYSTEM_EVENTS`.
   * 2. Persistence: Upserts the event definition into the `CustomEventDef` collection.
   * 3. Mapping: Allows mapping a custom trigger (e.g., from a Zapier webhook) to a specific pipeline/stage.
   *
   * **EDGE CASES:**
   * - Reserved Names: Throws an error if a tenant tries to hijack "lead_created" or other system names.
   * - Duplicates: Re-registering the same name simply updates the configuration.
   *
   * @param {string} clientCode - Tenant identifier.
   * @param {object} input - Event metadata (name, pipeline, etc.).
   */
  async registerEvent(
    clientCode: string,
    input: {
      name: string;
      displayName: string;
      description?: string;
      pipelineId?: string;
      stageId?: string;
      defaultSource?: string;
    },
  ) {
    const { CustomEventDef } = await getCrmModels(clientCode);

    // Check if name conflicts with system events
    if (SYSTEM_EVENTS.some((se) => se.name === input.name)) {
      throw new Error(`Event name "${input.name}" is reserved by the system.`);
    }

    return CustomEventDef.findOneAndUpdate(
      { clientCode, name: input.name },
      { ...input, clientCode, isSystem: false, isActive: true },
      { upsert: true, new: true },
    );
  },

  /**
   * Deactivate/Remove a custom event assignment
   *
   * **WORKING PROCESS:**
   * 1. Deactivation: Sets `isActive` to `false` in the `CustomEventDef` collection.
   * 2. Isolation: Ensures the change is scoped to the specific `clientCode`.
   *
   * @param {string} clientCode - Tenant identifier.
   * @param {string} eventName - Name of the event to deactivate.
   * @returns {Promise<object>} The updated event definition.
   */
  async unassignEvent(clientCode: string, eventName: string) {
    const { CustomEventDef } = await getCrmModels(clientCode);
    return CustomEventDef.findOneAndUpdate(
      { clientCode, name: eventName },
      { isActive: false },
      { new: true },
    );
  },

  /**
   * Deactivates multiple custom event assignments.
   *
   * @param {string} clientCode - Tenant identifier.
   * @param {string[]} eventNames - Array of event names to deactivate.
   * @returns {Promise<object>} Result of the bulk update operation.
   */
  async unassignEvents(clientCode: string, eventNames: string[]) {
    const { CustomEventDef } = await getCrmModels(clientCode);
    return CustomEventDef.updateMany(
      { clientCode, name: { $in: eventNames } },
      { isActive: false },
    );
  },
};
