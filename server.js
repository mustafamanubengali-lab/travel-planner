require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const LocationAgent = require('./src/agents/location-agent');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const locationAgent = new LocationAgent(process.env.GEMINI_API_KEY);

// Store location search results (keyed by session ID)
const searchResults = new Map();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Store conversations in memory (keyed by session ID)
const sessions = new Map();

const SYSTEM_PROMPT = `You are a travel agent bot. Your goal is to understand where the user wants to go, and use that to determine possible locations.

You need to gather 4 required pieces of information:
1. **Current location / starting point** — where they're traveling from
2. **Trip type(s)** — e.g. beach, adventure, partying, city, cultural, relaxation, nature, road trip (can be multiple)
3. **Budget** — total or per-person budget with currency
4. **Number of people** — solo, couple, group size

RULES:
- Extract ONLY what the user explicitly says. Do NOT assume, infer, or add details they didn't mention. For example, if they say "somewhere sunny", do NOT assume they want a beach trip — "sunny" is just a constraint.
- If something is unclear, you can check to confirm, but don't put words in their mouth.
- For any MISSING required fields, ask a short, natural follow-up question.
- Ask about at most 2 missing fields per message to keep it natural.
- Keep your responses concise — don't over-explain or repeat yourself.
- Any extra details (food preferences, flight duration limits, dates, weather preferences, etc.) are optional constraints — note them without expanding on them.
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

// Trigger location discovery agent
app.post('/api/discover', async (req, res) => {
  const { sessionId, requirements } = req.body;

  if (!requirements) {
    return res.status(400).json({ error: 'requirements are required' });
  }

  // Start the search — respond immediately, client will poll for results
  searchResults.set(sessionId, { status: 'searching', clusters: null });

  // Run in background
  locationAgent
    .findLocations(requirements)
    .then((clusters) => {
      searchResults.set(sessionId, { status: 'done', clusters });
    })
    .catch((err) => {
      console.error('Location agent error:', err);
      searchResults.set(sessionId, { status: 'error', error: err.message });
    });

  res.json({ status: 'searching' });
});

// Poll for discovery results
app.get('/api/discover/:sessionId', (req, res) => {
  const result = searchResults.get(req.params.sessionId);
  if (!result) return res.json({ status: 'not_started' });
  res.json(result);
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    sessions.delete(sessionId);
    searchResults.delete(sessionId);
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Travel Planner running on http://localhost:${PORT}`));
