import type { Schema } from "mongoose";
import CommunicationWorkflow from "./whatsapp/communication-workflow.model.ts";
import Conversation, {
  ConversationSchema,
} from "./whatsapp/conversation.model.ts";
import Message, { MessageSchema } from "./whatsapp/message.model.ts";
import Template, { TemplateSchema } from "./whatsapp/template.model.ts";

export {
  Conversation,
  ConversationSchema,
  Message,
  MessageSchema,
  Template,
  TemplateSchema
};

export const schemas: Record<string, Schema<any>> = {
  conversations: ConversationSchema,
  messages: MessageSchema,
  templates: TemplateSchema,
  communicationWorkflows: CommunicationWorkflow.schema,
};
