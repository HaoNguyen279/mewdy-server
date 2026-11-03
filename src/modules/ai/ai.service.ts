import OpenAI from "openai";

const AI_MODEL = "mewdy-chat";

export class AiHttpError extends Error {
  readonly exposeStack = false;

  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AiHttpError";
  }
}

type OpenAiChatClient = Pick<OpenAI, "chat">;

function getAiClient(): OpenAI {
  const apiKey = process.env.LITELLM_API_KEY?.trim();
  const baseURL = process.env.LITELLM_BASE_URL?.trim();
  if (!apiKey || !baseURL) {
    throw new AiHttpError(503, "AI service is not configured");
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout: 35_000,
    // A retry can trigger another paid completion after an ambiguous timeout.
    maxRetries: 0,
  });
}

export function createChatWithAI(client: OpenAiChatClient) {
  return async function chatWithAI(message: string) {
    try {
      const response = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: "system", content: "You are Mewdy AI assistant." },
          { role: "user", content: message },
        ],
        max_tokens: 1200,
      });

      return {
        content: response.choices[0]?.message.content ?? "",
        usage: response.usage,
        // Return the configured LiteLLM alias, never an upstream provider/model name.
        model: AI_MODEL,
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      console.error("[AI] LiteLLM request failed", { errorName, status });

      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new AiHttpError(504, "AI service timed out");
      }

      throw new AiHttpError(502, "AI service request failed");
    }
  };
}

let aiClient: OpenAI | undefined;

export function chatWithAI(message: string) {
  aiClient ??= getAiClient();
  return createChatWithAI(aiClient)(message);
}
