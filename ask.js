// Vercel serverless function: proxies chat questions to Google's Gemini API
// (free tier, no billing attached) so anonymous visitors with no Claude
// account can use the chat. The API key lives only in the GEMINI_API_KEY
// environment variable on Vercel and is never sent to the browser.

function phaseLabel() {
  var now = new Date();
  var phase2 = new Date("2026-11-13T00:00:00Z");
  var phase3 = new Date("2027-05-14T00:00:00Z");
  var todayStr = now.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  var label;
  if (now < phase2) label = "Phase 1 is in force; the Consent Manager registration duty and mandatory core Data Fiduciary obligations are not yet legally enforceable.";
  else if (now < phase3) label = "Phase 2 is in force (Consent Manager registration duty applies); the core Data Fiduciary obligations and Data Principal rights are not yet legally enforceable.";
  else label = "Phase 3 is in force; the core Act obligations and Data Principal rights are now legally enforceable.";
  return { todayStr: todayStr, label: label };
}

function systemPreamble() {
  var p = phaseLabel();
  return [
    "You are an explainer for India's Digital Personal Data Protection Act, 2023 (\"DPDP Act\") and the Digital Personal Data Protection Rules, 2025 (\"DPDP Rules\"), built by an Indian advocate as a public educational resource.",
    "Today's date is " + p.todayStr + ". " + p.label + " The Act and Rules commence in three phases (roughly Nov 2025, Nov 2026, May 2027) — always be precise about whether something is already legally enforceable or not yet in force, using today's date, not your own assumptions.",
    "Answer ONLY using the source excerpts provided in the user message plus ordinary knowledge of how Indian legal citations work. Do not invent section/rule numbers, penalty figures, or deadlines that are not in the excerpts. If the excerpts do not cover the question, say so plainly and suggest what to check instead, rather than guessing.",
    "Always name the specific Section, Rule, or Schedule you are relying on (e.g. \"Section 8(6)\" or \"Rule 7\").",
    "This is educational information, not legal advice for anyone's specific situation. Do not tell the user what to do in a specific dispute or transaction — explain what the law says and recommend consulting a qualified lawyer for their specific facts.",
    "No official government FAQ on the DPDP Act was found during research — never attribute an answer to a \"MeitY FAQ\".",
    "The Data Protection Board's staffing and operational status changes over time and may be out of date in the excerpts — flag that explicitly if the question turns on whether the Board is actively functioning.",
    "Keep answers concise and plain-language: short paragraphs or bullet points, minimal legalese, no filler.",
    "If asked something unrelated to Indian data protection law, politely say this tool only covers the DPDP Act and Rules."
  ].join(" ");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "server_not_configured", message: "GEMINI_API_KEY is not set on the server." });
    return;
  }

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch (e) { res.status(400).json({ error: "bad_request" }); return; }
  }
  body = body || {};

  var question = body.question;
  var context = body.context || "";
  var history = Array.isArray(body.history) ? body.history : [];

  if (!question || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "missing_question" });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: "question_too_long", message: "Please ask a shorter question (under 2000 characters)." });
    return;
  }

  var contents = [];
  history.slice(-12).forEach(function (t) {
    if (!t || !t.content || !t.role) return;
    contents.push({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: String(t.content).slice(0, 4000) }]
    });
  });

  var finalText =
    "SOURCE EXCERPTS FOR THIS QUESTION:\n" +
    String(context).slice(0, 14000) +
    "\n\nQUESTION: " + question.slice(0, 2000);
  contents.push({ role: "user", parts: [{ text: finalText }] });

  var model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;

  try {
    var upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPreamble() }] },
        contents: contents,
        generationConfig: { temperature: 0.25, maxOutputTokens: 1024 }
      })
    });

    var data = await upstream.json();

    if (!upstream.ok) {
      var upstreamMsg = (data && data.error && data.error.message) || "Upstream error from the model provider.";
      res.status(upstream.status === 429 ? 429 : 502).json({ error: "upstream_error", message: upstreamMsg });
      return;
    }

    var candidate = data && data.candidates && data.candidates[0];
    var text = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map(function (p) { return p.text || ""; }).join("")
      : "";

    if (!text) {
      var blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
      res.status(502).json({ error: "empty_response", message: blockReason ? ("Blocked: " + blockReason) : "The model returned an empty response." });
      return;
    }

    res.status(200).json({ text: text });
  } catch (err) {
    res.status(502).json({ error: "network_error", message: String((err && err.message) || err) });
  }
};
