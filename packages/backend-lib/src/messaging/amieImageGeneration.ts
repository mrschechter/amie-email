import { randomUUID } from "crypto";
import { AmieAsset } from "isomorphic-lib/src/amieAssets";

import { AssetStorageClient, putAssetObject } from "../blobStorage";
import config from "../config";

export type AmieImageAspect = "16:9" | "1:1" | "4:5";
export type AmieImageProvider = "openai" | "google";
export type AmieImageQuality = "low" | "medium" | "high" | "auto";

export const AMIE_BRAND_PHOTOGRAPHY_PREFIX =
  "Amie brand photography: clean, warm, ivory and blush palette, natural light, real skin texture, no text in image. ";

export interface GeneratedImage {
  bytes: Buffer;
  contentType: "image/png" | "image/jpeg" | "image/webp";
}

interface GenerateImageOptions {
  prompt: string;
  aspect: AmieImageAspect;
  provider?: AmieImageProvider;
  model?: string;
  quality?: AmieImageQuality;
  openaiApiKey?: string;
  geminiApiKey?: string;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function asBase64(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json().then((value: unknown) => value);
}

async function providerErrorDetail(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  if (!body) return "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const { message } = parsed.error;
      if (typeof message === "string") return message.slice(0, 300);
    }
  } catch {
    // A non-JSON provider response is still useful diagnostic context.
  }
  return body.slice(0, 300);
}

async function providerError(
  provider: string,
  response: Response,
): Promise<Error> {
  const detail = await providerErrorDetail(response);
  const suffix = detail ? `: ${detail}` : "";
  return new Error(
    `${provider} image generation failed (${response.status})${suffix}`,
  );
}

function openAiSize(aspect: AmieImageAspect): string {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "4:5") return "1024x1536";
  return "1024x1024";
}

async function generateOpenAiImage({
  prompt,
  aspect,
  model,
  quality,
  apiKey,
  fetchImpl,
}: {
  prompt: string;
  aspect: AmieImageAspect;
  model: string;
  quality: AmieImageQuality;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImage> {
  const response = await fetchImpl(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: openAiSize(aspect),
        quality,
      }),
    },
  );
  if (!response.ok) throw await providerError("OpenAI", response);
  const payload = await responseJson(response);
  const first =
    isRecord(payload) && isUnknownArray(payload.data)
      ? payload.data[0]
      : undefined;
  const base64 = isRecord(first) ? asBase64(first.b64_json) : null;
  if (!base64)
    throw new Error("OpenAI image response did not contain b64_json");
  return { bytes: Buffer.from(base64, "base64"), contentType: "image/png" };
}

async function generateGoogleImage({
  prompt,
  aspect,
  apiKey,
  fetchImpl,
}: {
  prompt: string;
  aspect: AmieImageAspect;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImage> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: aspect },
      },
    }),
  });
  if (!response.ok) throw await providerError("Gemini", response);
  const payload = await responseJson(response);
  const candidates =
    isRecord(payload) && isUnknownArray(payload.candidates)
      ? payload.candidates
      : [];
  const candidate = candidates[0];
  const content =
    isRecord(candidate) && isRecord(candidate.content)
      ? candidate.content
      : null;
  const parts = content && isUnknownArray(content.parts) ? content.parts : [];
  const imagePart = parts.find(
    (part) => isRecord(part) && isRecord(part.inlineData),
  );
  const inlineData =
    isRecord(imagePart) && isRecord(imagePart.inlineData)
      ? imagePart.inlineData
      : null;
  const base64 = inlineData ? asBase64(inlineData.data) : null;
  if (!base64)
    throw new Error("Gemini image response did not contain inline image data");
  const mimeType = inlineData?.mimeType;
  const contentType =
    mimeType === "image/jpeg" || mimeType === "image/webp"
      ? mimeType
      : "image/png";
  return { bytes: Buffer.from(base64, "base64"), contentType };
}

export async function generateImage({
  prompt,
  aspect,
  provider = config().amieImageGenProvider,
  model = config().amieImageGenModel,
  quality = config().amieImageGenQuality,
  openaiApiKey = config().openaiApiKey,
  geminiApiKey = config().geminiApiKey,
  fetchImpl = fetch,
}: GenerateImageOptions): Promise<GeneratedImage> {
  const brandedPrompt = `${AMIE_BRAND_PHOTOGRAPHY_PREFIX}${prompt.trim()}`;
  if (provider === "openai") {
    if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");
    return generateOpenAiImage({
      prompt: brandedPrompt,
      aspect,
      model,
      quality,
      apiKey: openaiApiKey,
      fetchImpl,
    });
  }
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");
  return generateGoogleImage({
    prompt: brandedPrompt,
    aspect,
    apiKey: geminiApiKey,
    fetchImpl,
  });
}

function extension(contentType: GeneratedImage["contentType"]): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

export async function generateAndStoreImage({
  workspaceId,
  prompt,
  aspect,
  storageClient,
  generate = generateImage,
}: {
  workspaceId: string;
  prompt: string;
  aspect: AmieImageAspect;
  storageClient: AssetStorageClient;
  generate?: (options: {
    prompt: string;
    aspect: AmieImageAspect;
  }) => Promise<GeneratedImage>;
}): Promise<AmieAsset> {
  const generated = await generate({ prompt, aspect });
  const key = `public/${workspaceId}/generated/${randomUUID()}.${extension(generated.contentType)}`;
  await putAssetObject(storageClient, {
    key,
    body: generated.bytes,
    contentType: generated.contentType,
  });
  const publicBase = config().amieAssetsPublicBaseUrl.replace(/\/$/, "");
  return {
    id: key,
    url: `${publicBase}/${key}`,
    name: `AI generated · ${prompt.trim().slice(0, 80)}`,
    alt: prompt.trim(),
    size: generated.bytes.byteLength,
    contentType: generated.contentType,
  };
}
