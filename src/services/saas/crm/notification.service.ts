import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";

export const createNotification = async (
  clientCode: string,
  input: Record<string, any>,
) => {
  const { Notification } = await getCrmModels(clientCode);
  const notif = await Notification.create({
    clientCode,
    ...input,
  });
  return notif;
};
