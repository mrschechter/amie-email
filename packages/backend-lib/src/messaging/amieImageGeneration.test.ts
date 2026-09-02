import {
  AMIE_BRAND_PHOTOGRAPHY_PREFIX,
  generateImage,
} from "./amieImageGeneration";

function jsonResponse(value: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("Amie image generation", () => {
  it("calls OpenAI Images with the configured model and decodes b64_json", async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
      jsonResponse({
        data: [{ b64_json: Buffer.from("openai-image").toString("base64") }],
      }),
    );

    const result = await generateImage({
      prompt: "A woman preparing her evening routine",
      aspect: "16:9",
      provider: "openai",
      model: "gpt-image-2",
      quality: "high",
      openaiApiKey: "test-openai-key",
      geminiApiKey: "unused",
      fetchImpl,
    });

    expect(result.bytes.toString()).toBe("openai-image");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain('"model":"gpt-image-2"');
    expect(body).toContain('"size":"1536x1024"');
    expect(body).toContain('"quality":"high"');
    expect(body).not.toContain("response_format");
    expect(body).toContain(
      `${AMIE_BRAND_PHOTOGRAPHY_PREFIX}A woman preparing her evening routine`,
    );
  });

  it("calls Gemini REST with aspect ratio and decodes inlineData", async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("gemini-image").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    const result = await generateImage({
      prompt: "A warm product still life",
      aspect: "4:5",
      provider: "google",
      model: "unused",
      quality: "medium",
      openaiApiKey: "unused",
      geminiApiKey: "test-gemini-key",
      fetchImpl,
    });

    expect(result.bytes.toString()).toBe("gemini-image");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "gemini-3-pro-image:generateContent",
    );
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain('"aspectRatio":"4:5"');
    expect(body).toContain(
      `${AMIE_BRAND_PHOTOGRAPHY_PREFIX}A warm product still life`,
    );
  });

  it("propagates OpenAI's error.message in non-2xx failures", async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
      jsonResponse(
        {
          error: {
            message: "Unknown parameter: 'response_format'.",
          },
        },
        400,
      ),
    );

    await expect(
      generateImage({
        prompt: "A product hero",
        aspect: "16:9",
        provider: "openai",
        model: "gpt-image-2",
        quality: "medium",
        openaiApiKey: "test-openai-key",
        geminiApiKey: "unused",
        fetchImpl,
      }),
    ).rejects.toThrow(
      "OpenAI image generation failed (400): Unknown parameter: 'response_format'.",
    );
  });

  it("propagates and truncates a Gemini non-JSON error body", async () => {
    const providerMessage = "Gemini unavailable ".repeat(30);
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
      Promise.resolve(new Response(providerMessage, { status: 503 })),
    );

    await expect(
      generateImage({
        prompt: "A product hero",
        aspect: "1:1",
        provider: "google",
        model: "unused",
        quality: "medium",
        openaiApiKey: "unused",
        geminiApiKey: "test-gemini-key",
        fetchImpl,
      }),
    ).rejects.toThrow(
      `Gemini image generation failed (503): ${providerMessage.slice(0, 300)}`,
    );
  });
});
