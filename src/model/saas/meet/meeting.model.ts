import mongoose, { Schema } from "mongoose";

const meetingSchema: Schema<IMeeting> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    participantName: {
      type: String,
      required: true,
      trim: true,
    },
    participantPhone: {
      type: String,
      required: true,
      trim: true,
    },
    participantEmails: {
      type: [String],
      default: [],
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    duration: {
      type: Number, // minutes
      required: true,
    },
    meetingMode: {
      type: String,
      enum: ["online", "offline"],
      default: "online",
    },
    meetLink: {
      type: String,
      default: null,
    },
    meetCode: {
      type: String,
      default: null,
    },
    eventId: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
    },
    amount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "na"],
      default: "na",
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled", "pending"],
      default: "pending",
    },
    reminders: [
      {
        actionId: { type: String, required: true },
        type: {
          type: String,
          enum: ["send_whatsapp", "send_email"],
          required: true,
        },
        fireTime: { type: Date, required: true },
        status: {
          type: String,
          enum: ["pending", "sent", "failed"],
          default: "pending",
        },
        error: { type: String, default: null },
        sentAt: { type: Date, default: null },
      },
    ],
    metadata: {
      refs: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: () => ({}),
      },
      extra: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({}),
      },
    },
  },
  { timestamps: true },
);

// Indexes
meetingSchema.index({ clientCode: 1, leadId: 1 });
meetingSchema.index(
  { clientCode: 1, "metadata.refs.appointmentId": 1 },
  { sparse: true },
);
meetingSchema.index({ clientCode: 1, startTime: 1 });

export { meetingSchema as MeetingSchema };
export default meetingSchema;
