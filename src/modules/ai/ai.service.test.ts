import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { createChatWithAI } from "./ai.service.js";
import { aiChatRequestSchema } from "./ai.validation.js";

test("AI chat validation trims messages and enforces the length limit", () => {
  assert.deepEqual(aiChatRequestSchema.parse({ message: "  hello  " }), { message: "hello" });
  assert.equal(aiChatRequestSchema.safeParse({ message: "   " }).success, false);
  assert.equal(aiChatRequestSchema.safeParse({ message: "x".repeat(2001) }).success, false);
});

test("AI service calls the LiteLLM model alias and handles null content", async () => {
  let request: Record<string, unknown> | undefined;
  const client = {
    chat: {
      completions: {
        create: async (input: Record<string, unknown>) => {
          request = input;
          return {
            choices: [{ message: { content: null } }],
            usage: { prompt_tokens: 4, completion_tokens: 0, total_tokens: 4 },
            model: "provider-private-model",
          };
        },
      },
    },
  } as unknown as OpenAI;

  const result = await createChatWithAI(client)("hello");
  assert.equal(request?.model, "mewdy-chat");
  assert.equal(result.content, "");
  assert.equal(result.model, "mewdy-chat");
  assert.deepEqual(result.usage, { prompt_tokens: 4, completion_tokens: 0, total_tokens: 4 });
});

test("AI service maps a LiteLLM timeout to HTTP 504 without exposing provider details", async () => {
  const client = {
    chat: {
      completions: {
        create: async () => { throw new OpenAI.APIConnectionTimeoutError({ message: "private detail" }); },
      },
    },
  } as unknown as OpenAI;

  await assert.rejects(createChatWithAI(client)("hello"), (error: unknown) => {
    assert.equal((error as { statusCode: number }).statusCode, 504);
    assert.equal((error as Error).message, "AI service timed out");
    assert.equal((error as { exposeStack: boolean }).exposeStack, false);
    return true;
  });
});
