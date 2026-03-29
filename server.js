require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Store conversations in memory (keyed by session ID)
const sessions = new Map();

const SYSTEM_PROMPT = `You are a friendly travel planning assistant. Your job is to help the user plan their ideal trip.

You need to gather 4 required pieces of information:
1. **Current location** — where they're traveling from
2. **Trip type(s)** — e.g. beach, adventure, partying, city, cultural, relaxation, nature, road trip (can be multiple)
3. **Budget** — total or per-person budget with currency
4. **Number of people** — solo, couple, group size

RULES:
- The user will describe their trip in natural language. Extract whatever you can from their message.
- For any MISSING required fields, ask a natural follow-up question. Don't be robotic — be conversational and warm.
- Ask about at most 2 missing fields per message to keep it natural.
- Any extra details (food preferences, flight duration limits, accessibility needs, dates, etc.) are optional constraints — acknowledge them.
- Once you have ALL 4 required fields, confirm what you've gathered in a brief summary and say you're ready to find destinations.

RESPONSE FORMAT:
You must respond with valid JSON in this exact structure:
{
  "message": "Your conversational response to the user",
  "extracted": {
    "location": null or "string",
    "tripTypes": null or ["array", "of", "types"],
    "budget": null or "string description",
    "numberOfPeople": null or number,
    "optionalConstraints": ["any", "extra", "preferences"]
  },
  "complete": false
}

Set "complete" to true ONLY when all 4 required fields are gathered.
Always include ALL previously extracted data in every response (don't drop fields you already know).`;

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId are required' });
  }

  // Get or create session history
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }
  const history = sessions.get(sessionId);

  // Build the conversation for Gemini
  const contents = [
    { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\nUser says: ' + (history.length === 0 ? message : '') }] },
  ];

  // Rebuild conversation history
  if (history.length > 0) {
    // First exchange already includes system prompt
    contents[0].parts[0].text = SYSTEM_PROMPT + '\n\nUser says: ' + history[0].user;
    contents.push({ role: 'model', parts: [{ text: JSON.stringify(history[0].assistant) }] });

    for (let i = 1; i < history.length; i++) {
      contents.push({ role: 'user', parts: [{ text: history[i].user }] });
      contents.push({ role: 'model', parts: [{ text: JSON.stringify(history[i].assistant) }] });
    }

    // Add current message
    contents.push({ role: 'user', parts: [{ text: message }] });
  } else {
    contents[0].parts[0].text = SYSTEM_PROMPT + '\n\nUser says: ' + message;
  }

  try {
    const result = await model.generateContent({ contents });
    const responseText = result.response.text();

    // Parse JSON from Gemini's response (strip markdown code fences if present)
    let parsed;
    try {
      const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If Gemini didn't return valid JSON, wrap it
      parsed = {
        message: responseText,
        extracted: { location: null, tripTypes: null, budget: null, numberOfPeople: null, optionalConstraints: [] },
        complete: false,
      };
    }

    // Save to session history
    history.push({ user: message, assistant: parsed });

    res.json(parsed);
  } catch (err) {
    console.error('Gemini API error:', err);
    res.status(500).json({ error: 'Failed to process your message' });
  }
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) sessions.delete(sessionId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Travel Planner running on http://localhost:${PORT}`));
