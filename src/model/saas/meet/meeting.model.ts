import mongoose, { Schema } from "mongoose";

const meetingSchema: Schema<IMeeting> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    doctorId: {
      type: String, // Can be ObjectId or string ID from client
      default: null,
    },
    patientName: {
      type: String,
      required: true,
      trim: true,
    },
    patientPhone: {
      type: String,
      required: true,
      trim: true,
    },
    patientEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
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
    consultationType: {
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
  },
  { timestamps: true },
);

// Indexes
meetingSchema.index({ clientCode: 1, leadId: 1 });
meetingSchema.index({ clientCode: 1, appointmentId: 1 });
meetingSchema.index({ clientCode: 1, startTime: 1 });

export { meetingSchema as MeetingSchema };
export default meetingSchema;
