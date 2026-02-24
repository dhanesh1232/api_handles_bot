import "express";

declare global {
  namespace Express {
    interface Request {
      clientCode?: string;
    }
  }
}
