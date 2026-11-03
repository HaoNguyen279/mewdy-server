import { Router } from "express";
import { requireChatAuth } from "../chat/chat.auth.js";
import { chatController } from "./ai.controller.js";
import { aiUserRateLimit, validateAiChatRequest } from "./ai.middleware.js";

const router = Router();

router.post("/chat", requireChatAuth, validateAiChatRequest, aiUserRateLimit, chatController);

export default router;
