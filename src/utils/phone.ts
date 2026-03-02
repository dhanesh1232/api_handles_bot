export function normalizePhone(rawPhone: string | null | undefined): string {
  if (!rawPhone) return "";

  // 1. Strip everything except digits
  let cleaned = rawPhone.replace(/[^\d]/g, "");

  // 2. Identify Indian sub-continent prefix standardizing
  // If the user provided exactly 10 digits (assumed local Indian mobile number format)
  // We prepend 91 to standardize universally across WhatsApp Meta API requirements.
  if (cleaned.length === 10) {
    cleaned = `91${cleaned}`;
  }

  // 3. (Optional) if it starts with leading zeros (common in some regions), strip them before country code prepending,
  // but for now relying on the 10-digit strict check above solves the immediate 91 vs non-91 E.164 issue.

  return cleaned;
}
