export type SiteGeneration = {
  title: string;
  html: string;
  reply: string;
  costUsd: number;
};

export type GeneratedImage = {
  data: Uint8Array<ArrayBuffer>;
  mimeType: "image/png";
  costUsd: number;
};

export type PlanGeneration = {
  title: string;
  markdown: string;
  flyerRequest: string;
  reply: string;
  costUsd: number;
};

type ResponseBody = {
  output_text?: string;
  error?: { message?: string };
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
};

const instructions = `あなたは日本語のウェブサイト制作アシスタントです。
ユーザーの指示を反映した、完成した単一HTML文書を返してください。
- HTMLにはCSSを<style>内に含める
- 必要に応じてインラインJavaScript、Canvas、WebGLを積極的に使い、操作感や動きのあるリッチな表現にする
- スマホで重くならないよう、描画負荷、アニメーション量、デバイス性能、prefers-reduced-motionに配慮する
- 外部スクリプト、フォーム、iframe、ネットワーク通信は使用しない
- レスポンシブで、読みやすく魅力的なデザインにする
- 既存HTMLがある場合は、その内容を維持しつつ指示箇所を更新する
- titleはサイト名だけを80文字以内で返す
- replyは実施内容を日本語で簡潔に説明する`;

const planInstructions = `あなたは日本語の企画書作成アシスタントです。
ユーザーの要望を反映した、実行に使える企画書をMarkdown形式で作成してください。
- 目的、背景、対象、提供価値、実施内容、スケジュール、予算・体制、成果指標、リスクと対策を必要に応じて整理する
- 不明な情報は断定せず「要確認」と明示する
- 見出し、箇条書き、表を使い、簡潔で読みやすくする
- 既存の企画書がある場合は内容を維持しつつ指示箇所を改善する
- 企画内容をチラシ制作向けのコンパクトな文章に凝縮したflyer_requestを必ず作る
- markdownにはMarkdown本文だけを含める
- titleは企画名だけを80文字以内で返す
- replyは実施内容を日本語で簡潔に説明する`;

export async function generatePlan(
  apiKey: string,
  instruction: string,
  currentMarkdown: string,
  currentTitle: string,
  model = "gpt-5.6-luna",
  inputUsdPerMillion = 0.2,
  outputUsdPerMillion = 1.2,
  cachedInputUsdPerMillion = 0.02,
): Promise<PlanGeneration> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 8000,
      instructions: planInstructions,
      input:
        `現在のタイトル:\n${currentTitle}\n\n現在の企画書:\n${currentMarkdown}\n\nユーザーの指示:\n${instruction}`,
      text: {
        format: {
          type: "json_schema",
          name: "plan_update",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              markdown: { type: "string" },
              flyer_request: { type: "string" },
              reply: { type: "string" },
            },
            required: ["title", "markdown", "flyer_request", "reply"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const result = await response.json() as ResponseBody;
  if (!response.ok) {
    throw new Error(
      result.error?.message ?? `OpenAI API error (${response.status})`,
    );
  }
  const outputText = result.output_text ?? result.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("");
  if (!outputText) throw new Error("OpenAI API returned no output");
  const generated = JSON.parse(outputText) as Partial<PlanGeneration> & {
    flyer_request?: unknown;
  };
  if (
    typeof generated.title !== "string" ||
    typeof generated.markdown !== "string" ||
    typeof generated.flyer_request !== "string" ||
    typeof generated.reply !== "string" ||
    !generated.title.trim() || !generated.markdown.trim() ||
    !generated.flyer_request.trim() ||
    !generated.reply.trim()
  ) throw new Error("OpenAI API returned an invalid plan");
  const inputTokens = result.usage?.input_tokens ?? 0;
  const cachedTokens = result.usage?.input_tokens_details?.cached_tokens ?? 0;
  const flyerRequest = generated.flyer_request.trim();
  const markdown = generated.markdown.trim().replace(
    /\n*## チラシ作成依頼文章\s*\n[\s\S]*?(?=\n## |$)/,
    "",
  ).trim();
  return {
    title: generated.title.trim().slice(0, 80),
    markdown: `${markdown}\n\n## チラシ作成依頼文章\n\n${flyerRequest}`,
    flyerRequest,
    reply: generated.reply.trim(),
    costUsd: ((inputTokens - cachedTokens) * inputUsdPerMillion +
      cachedTokens * cachedInputUsdPerMillion +
      (result.usage?.output_tokens ?? 0) * outputUsdPerMillion) / 1_000_000,
  };
}

export async function generateSite(
  apiKey: string,
  instruction: string,
  currentHtml: string,
  currentTitle: string,
  model = "gpt-5.6-luna",
  inputUsdPerMillion = 0.2,
  outputUsdPerMillion = 1.2,
  cachedInputUsdPerMillion = 0.02,
): Promise<SiteGeneration> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 12_000,
      instructions,
      input:
        `現在のタイトル:\n${currentTitle}\n\n現在のHTML:\n${currentHtml}\n\nユーザーの指示:\n${instruction}`,
      text: {
        format: {
          type: "json_schema",
          name: "website_update",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              html: { type: "string" },
              reply: { type: "string" },
            },
            required: ["title", "html", "reply"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const result = await response.json() as ResponseBody;
  if (!response.ok) {
    throw new Error(
      result.error?.message ?? `OpenAI API error (${response.status})`,
    );
  }
  const generated = parseSiteGeneration(result);
  const inputTokens = result.usage?.input_tokens ?? 0;
  const cachedTokens = result.usage?.input_tokens_details?.cached_tokens ?? 0;
  generated.costUsd = ((inputTokens - cachedTokens) * inputUsdPerMillion +
    cachedTokens * cachedInputUsdPerMillion +
    (result.usage?.output_tokens ?? 0) * outputUsdPerMillion) / 1_000_000;
  return generated;
}

export function parseSiteGeneration(result: ResponseBody): SiteGeneration {
  const refusal = result.output?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "refusal")?.refusal;
  if (refusal) throw new Error(`OpenAI API refused the request: ${refusal}`);

  const outputText = result.output_text ?? result.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("");
  if (!outputText) {
    const detail = result.incomplete_details?.reason ?? result.status;
    throw new Error(
      detail
        ? `OpenAI API returned no output (${detail})`
        : "OpenAI API returned no output",
    );
  }

  let generated: Partial<SiteGeneration>;
  try {
    generated = JSON.parse(outputText) as Partial<SiteGeneration>;
  } catch {
    throw new Error("OpenAI API returned invalid JSON");
  }
  if (
    typeof generated.title !== "string" ||
    typeof generated.html !== "string" ||
    typeof generated.reply !== "string" ||
    !generated.title.trim() || !generated.html.includes("<html") ||
    !generated.reply.trim()
  ) throw new Error("OpenAI API returned an invalid website");
  return {
    title: generated.title.trim().slice(0, 80),
    html: generated.html,
    reply: generated.reply.trim(),
    costUsd: 0,
  };
}

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export async function generateImage(
  apiKey: string,
  prompt: string,
  model = "gpt-image-2",
  source?: { data: Uint8Array; mimeType: string; name: string },
  costUsd = 0.034,
  size = "1024x1024",
): Promise<GeneratedImage> {
  let response: Response;
  if (source) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("size", size);
    form.set(
      "image",
      new Blob([source.data as Uint8Array<ArrayBuffer>], {
        type: source.mimeType,
      }),
      source.name,
    );
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, prompt, size }),
    });
  }
  const result = await response.json() as ImageResponse;
  if (!response.ok) {
    const message = result.error?.message ??
      `OpenAI Image API error (${response.status})`;
    if (size !== "auto" && /size|dimension|resolution/i.test(message)) {
      return await generateImage(
        apiKey,
        prompt,
        model,
        source,
        costUsd,
        "auto",
      );
    }
    throw new Error(message);
  }
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI Image API returned no image");
  return { data: decodeBase64(encoded), mimeType: "image/png", costUsd };
}
