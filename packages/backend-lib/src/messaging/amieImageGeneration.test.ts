import {
  AMIE_BRAND_PHOTOGRAPHY_PREFIX,
  generateImage,
} from "./amieImageGeneration";

function jsonResponse(value: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
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
});
