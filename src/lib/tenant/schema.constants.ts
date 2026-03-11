/**
 * Curated fields for major CRM collections.
 * These are shown as "Recommended" in the template mapping UI.
 */
export const CURATED_FIELDS: Record<string, Record<string, string>> = {
  leads: {
    firstName: "First Name",
    lastName: "Last Name",
    name: "Full Name",
    email: "Email Address",
    phone: "Phone Number",
    disease: "Disease / Chief Complaint",
    occupation: "Occupation",
    "selections.symptoms": "Disease Symptoms",
    reportUrl: "Report URL",
    source: "Source / Channel",
    "metadata.whatsApp": "WhatsApp Number",
  },
  meetings: {
    title: "Meeting Title",
    startTime: "Start Date & Time",
    endTime: "End Date & Time",
    meetLink: "Meeting Link",
    status: "Meeting Status",
    description: "Agenda / Description",
    doctorName: "Doctor Name",
    patientName: "Patient Name",
  },
  orders: {
    orderId: "Display Order ID",
    totalAmount: "Total Amount",
    status: "Order Status",
    createdAt: "Order Date",
    "shippingAddress.Name": "Shipping Name",
    "shippingAddress.City": "Shipping City",
    "payment.method": "Payment Method",
    "orderItems": "Order Items (Full List)",
  },
  doctors: {
    name: "Doctor Name",
    speciality: "Speciality",
    experience: "Years of Experience",
    consultationFee: "Consultation Fee",
  },
};

/**
 * Common automation trigger keys and their descriptions
 */
export const CURATED_TRIGGER_FIELDS: Record<string, string> = {
  meet_link: "Meeting Join URL",
  meet_code: "Meeting Passcode",
  order_id: "Order Reference ID",
  tracking_url: "Package Tracking URL",
  support_ticket_id: "Support Ticket Number",
  otp: "One-Time Password",
};
