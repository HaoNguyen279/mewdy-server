import { z } from "zod";

export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(2000, "Message cannot exceed 2000 characters"),
});

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
