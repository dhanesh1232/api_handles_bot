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
   * Get all events for a client (System + Registered Custom)
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
      })),
    ];
  },

  /**
   * Register a new custom event (Assigning an event)
   */
  async registerEvent(
    clientCode: string,
    input: {
      name: string;
      displayName: string;
      description?: string;
      pipelineId?: string;
      stageId?: string;
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
   */
  async unassignEvent(clientCode: string, eventName: string) {
    const { CustomEventDef } = await getCrmModels(clientCode);
    return CustomEventDef.findOneAndUpdate(
      { clientCode, name: eventName },
      { isActive: false },
      { new: true },
    );
  },
};
