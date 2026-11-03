import type { RequestHandler } from "express";
import { chatWithAI } from "./ai.service.js";

export const chatController: RequestHandler = async (req, res, next) => {
  try {
    const result = await chatWithAI(req.body.message as string);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
