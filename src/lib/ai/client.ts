import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude access for the portal. Everything AI is optional: with no
 * ANTHROPIC_API_KEY the portal works exactly as before, minus the AI features.
 */
export const AI_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

/**
 * Server-side fallback: if the model's safety classifiers decline a request, the
 * API re-runs it on Anthropic's recommended fallback model instead of returning
 * a refusal. Applications mention topics (abuse-prevention policies, injuries)
 * that are routine for insurance but could trip a classifier.
 */
export const fallbackParams = () => ({
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
});

export type AiClient = Pick<Anthropic, "beta">;

let client: Anthropic | undefined;
export function aiClient(): AiClient | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return client;
}

export class AiRefusalError extends Error {}

/** Text of a response, after checking it wasn't refused or cut off. */
export function responseText(msg: Anthropic.Beta.BetaMessage): string {
  if (msg.stop_reason === "refusal") throw new AiRefusalError("The AI model declined this request.");
  if (msg.stop_reason === "max_tokens") throw new Error("AI response was cut off (max_tokens).");
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
