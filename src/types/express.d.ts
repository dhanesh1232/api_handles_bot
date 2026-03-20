import "express";
import { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      clientCode?: string;
      sdk: SDK;
      log: Logger;
    }
  }
}
