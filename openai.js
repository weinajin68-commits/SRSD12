const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");

const systemPrompt = fs.readFileSync(
  path.join(process.cwd(), "prompts", "srsd-teacher.txt"),
  "utf8"
);

function buildInput(messages, originalText) {
  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: systemPrompt,
        },
      ],
    },
  ];

  if (originalText && originalText.trim()) {
    input.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            "Original reading passage for the continuation writing task:\n\n" +
            originalText.trim(),
        },
      ],
    });
  }

  for (const message of messages) {
    input.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [
        {
          type: "input_text",
          text: message.content,
        },
      ],
    });
  }
  return input;
}

function extractText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function generateTutorReply(messages, originalText) {
  if (!config.openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment.");
  }

  const payload = {
    model: config.openaiModel,
    store: false,
    input: buildInput(messages, originalText),
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = data && data.error && data.error.message ? data.error.message : "OpenAI request failed";
    throw new Error(error);
  }

  const text = extractText(data);
  if (!text) {
    throw new Error("The model returned an empty response.");
  }

  return {
    text,
    raw: data,
    request: payload,
  };
}

module.exports = {
  generateTutorReply,
};
