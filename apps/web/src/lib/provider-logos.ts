import amazonBedrock from "../assets/providers/amazon-bedrock.svg";
import anthropic from "../assets/providers/anthropic.svg";
import azure from "../assets/providers/azure.svg";
import baseten from "../assets/providers/baseten.svg";
import cerebras from "../assets/providers/cerebras.svg";
import cloudflare from "../assets/providers/cloudflare.svg";
import deepseek from "../assets/providers/deepseek.svg";
import fireworks from "../assets/providers/fireworks.svg";
import githubCopilot from "../assets/providers/github-copilot.svg";
import google from "../assets/providers/google.svg";
import googleVertex from "../assets/providers/google-vertex.svg";
import groq from "../assets/providers/groq.svg";
import huggingface from "../assets/providers/huggingface.svg";
import kimi from "../assets/providers/kimi.svg";
import meta from "../assets/providers/meta.svg";
import minimax from "../assets/providers/minimax.svg";
import mistral from "../assets/providers/mistral.svg";
import moonshot from "../assets/providers/moonshot.svg";
import nvidia from "../assets/providers/nvidia.svg";
import openai from "../assets/providers/openai.svg";
import opencode from "../assets/providers/opencode.svg";
import openrouter from "../assets/providers/openrouter.svg";
import qwen from "../assets/providers/qwen.svg";
import together from "../assets/providers/together.svg";
import vercel from "../assets/providers/vercel.svg";
import xai from "../assets/providers/xai.svg";
import xiaomi from "../assets/providers/xiaomi.svg";
import zhipu from "../assets/providers/zhipu.svg";

/**
 * Logo of each built-in provider, by the id of Pi's catalog. Regional or plan variants of a vendor
 * (`minimax-cn`, `zai-coding-cn`, `xiaomi-token-plan-ams`) share its logo through `LOGO_PREFIXES`.
 */
const LOGOS: Record<string, string> = {
  "amazon-bedrock": amazonBedrock,
  anthropic,
  azure,
  baseten,
  cerebras,
  deepseek,
  fireworks,
  "github-copilot": githubCopilot,
  google,
  "google-vertex": googleVertex,
  groq,
  huggingface,
  "kimi-coding": kimi,
  meta,
  mistral,
  nvidia,
  openai,
  "openai-codex": openai,
  openrouter,
  together,
  "vercel-ai-gateway": vercel,
  xai,
};

/** Vendors that ship several provider ids under one name. */
const LOGO_PREFIXES: [prefix: string, logo: string][] = [
  ["cloudflare", cloudflare],
  ["minimax", minimax],
  ["moonshotai", moonshot],
  ["opencode", opencode],
  ["qwen", qwen],
  ["xiaomi", xiaomi],
  ["zai", zhipu],
];

/** The vendor's logo for a built-in provider id, or null (gateways and unknown providers). */
export function providerLogo(providerId: string): string | null {
  return (
    LOGOS[providerId] ??
    LOGO_PREFIXES.find(([prefix]) => providerId.startsWith(prefix))?.[1] ??
    null
  );
}
