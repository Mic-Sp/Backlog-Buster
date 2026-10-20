const systemPrompt = "Role: You are a video game playtime auditor and backlog coach. Rule: First, compare the app's stored hours for this game against its real-world Main Story completion time and state the corrected hour estimate if the stored number is off. Second, give a 1-to-2 sentence pacing tip for beating it. Plain text only, maximum 3 sentences, no markdown.";

function json(body: { briefing: string } | { error: string }, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: "Game details are too long." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Please send valid JSON game details." }, 400);
  }

  if (!isRecord(body)) return json({ error: "Please provide game details." }, 400);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const platform = typeof body.platform === "string" ? body.platform.trim() : "";
  const genre = typeof body.genre === "string" ? body.genre.trim() : null;
  const year = body.year === "" || body.year == null ? null : body.year;
  const lengthHours = body.lengthHours;
  const hoursPlayed = body.hoursPlayed == null ? null : body.hoursPlayed;
  if (!title || title.length > 120 || !platform || platform.length > 80 ||
    (body.genre != null && typeof body.genre !== "string") || (genre !== null && genre.length > 200) ||
    (year !== null && (typeof year !== "number" || !Number.isInteger(year) || year < 1800 || year > 2100)) ||
    typeof lengthHours !== "number" || !Number.isInteger(lengthHours) || lengthHours < 1 || lengthHours > 10000 ||
    (hoursPlayed !== null && (typeof hoursPlayed !== "number" || !Number.isInteger(hoursPlayed) || hoursPlayed < 0 || hoursPlayed > 10000))) {
    return json({ error: "Provide a title, platform, valid release year (or blank), and stored hours from 1 to 10000." }, 400);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return json({ error: "Agent briefing is unavailable: GEMINI_API_KEY is not configured on the server." }, 503);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: [
          "Audit lengthHours, the app's stored total Main Story completion estimate. hoursPlayed is the player's actual logged progress, not the completion estimate.",
          "Treat the supplied logged hours as authoritative; never assume zero or that the player has not started. A null hoursPlayed means progress is unknown.",
          "Keep the pacing tip supportive and practical.",
          JSON.stringify({ title, platform, genre, year, lengthHours, hoursPlayed }),
        ].join("\n") }] }],
        generationConfig: { responseMimeType: "text/plain", maxOutputTokens: 1024 },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return json({ error: "The AI service is at its quota or rate limit. Please try again later." }, 429);
      if (response.status === 401 || response.status === 403) {
        return json({ error: "The AI service could not authorize the server's API key. Check its Gemini access." }, 503);
      }
      return json({ error: "The AI service is unavailable. Please retry the audit shortly." }, 502);
    }

    const result: unknown = await response.json();
    const candidate = isRecord(result) && Array.isArray(result.candidates) ? result.candidates[0] : null;
    const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : null;
    const parts: unknown[] = content && Array.isArray(content.parts) ? content.parts : [];
    const briefing = parts.flatMap((part) => isRecord(part) && part.thought !== true && typeof part.text === "string" ? [part.text] : []).join("\n").trim();
    if (!briefing) return json({ error: "The AI returned no briefing. Please retry the audit." }, 502);
    return json({ briefing });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return json({ error: "The audit timed out. Please try again." }, 504);
    }
    return json({ error: "Could not reach the AI service. Please try again." }, 502);
  }
}
