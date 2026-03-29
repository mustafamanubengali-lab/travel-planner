const { GoogleGenerativeAI } = require('@google/generative-ai');
const { haversineKm, allFarEnough, filterNearby } = require('../utils/distance');

class LocationAgent {
  constructor(apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ googleSearch: {} }],
    });
  }

  /**
   * Main entry point. Returns 5 clusters of destinations.
   * Optimized for minimal API calls: 1 for anchors + 1 for all nearby = 2 calls total.
   * (+ 1 more only if distance fix is needed)
   */
  async findLocations(requirements) {
    console.log('[LocationAgent] Starting location discovery...');

    // Step 1: Find 5 anchor destinations (1 API call)
    let anchors = await this.findAnchors(requirements);
    console.log(`[LocationAgent] Found ${anchors.length} anchors`);

    // Step 1b: Fix distances if needed (0-1 API call)
    if (!allFarEnough(anchors, 4000)) {
      console.log('[LocationAgent] Some anchors too close, fixing...');
      anchors = await this.fixAnchorDistances(anchors, requirements);
    }

    // Step 2: Find nearby places for ALL anchors in one batched call (1 API call)
    const clusters = await this.expandAllClusters(anchors, requirements);

    console.log('[LocationAgent] Location discovery complete.');
    return clusters;
  }

  /**
   * Find 5 anchor destinations >4000km apart. (1 API call)
   */
  async findAnchors(requirements) {
    const prompt = `You are a travel research agent. Suggest exactly 5 destination cities/regions for this trip.

REQUIREMENTS:
- Traveling from: ${requirements.location}
- Trip type(s): ${requirements.tripTypes.join(', ')}
- Budget: ${requirements.budget}
- Number of people: ${requirements.numberOfPeople}
${requirements.optionalConstraints.length > 0 ? '- Additional preferences: ' + requirements.optionalConstraints.join(', ') : ''}

RULES:
- Each destination must be at least 4000km apart from every other destination.
- Prioritize trendy, well-reviewed destinations. Search for current travel reviews.
- Consider the budget — match cost of living to their budget.
- Each place should satisfy the trip type requirements (or most of them).

Respond with ONLY a valid JSON array, no markdown fences:
[
  {
    "name": "City/Region, Country",
    "lat": 0.0,
    "lng": 0.0,
    "whyPicked": "Brief reason this is a great pick",
    "tripTypesCovered": ["types", "it", "covers"],
    "estimatedDailyCost": "$XX USD",
    "highlights": ["2-3 specific things to do or see"],
    "reviewSnippet": "Brief summary of what travelers say"
  }
]`;

    const result = await this.callGemini(prompt);
    return this.parseJsonResponse(result);
  }

  /**
   * Replace anchors that are too close. (1 API call)
   */
  async fixAnchorDistances(anchors, requirements) {
    const dropNames = new Set();
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const dist = haversineKm(anchors[i].lat, anchors[i].lng, anchors[j].lat, anchors[j].lng);
        if (dist < 4000 && !dropNames.has(anchors[i].name)) {
          dropNames.add(anchors[j].name);
        }
      }
    }

    const kept = anchors.filter((a) => !dropNames.has(a.name));

    const prompt = `Some destinations were too close (need >4000km apart).

KEEP these (do not change):
${kept.map((a) => `- ${a.name} (${a.lat}, ${a.lng})`).join('\n')}

Suggest ${dropNames.size} replacements that are >4000km from all kept destinations and from each other.
Requirements: ${requirements.tripTypes.join(', ')} trip, budget ${requirements.budget}, from ${requirements.location}.

Respond with ONLY a valid JSON array of destination objects (same structure: name, lat, lng, whyPicked, tripTypesCovered, estimatedDailyCost, highlights, reviewSnippet).`;

    const result = await this.callGemini(prompt);
    const replacements = this.parseJsonResponse(result);
    return [...kept, ...replacements].slice(0, 5);
  }

  /**
   * Batch-expand all 5 anchors into clusters in a SINGLE API call. (1 API call)
   * Uses tree logic: Gemini picks nearby places, and some can branch from others.
   */
  async expandAllClusters(anchors, requirements) {
    const anchorList = anchors
      .map((a, i) => `${i + 1}. ${a.name} (${a.lat}, ${a.lng})`)
      .join('\n');

    const prompt = `You are a travel research agent. For each of these 5 anchor destinations, find 3-4 nearby places worth visiting (within 1000km).

ANCHORS:
${anchorList}

TRIP REQUIREMENTS:
- Trip type(s): ${requirements.tripTypes.join(', ')}
- Budget: ${requirements.budget}

RULES:
- Each nearby place must be within 1000km of its anchor OR within 1000km of another nearby place in the same group (tree expansion).
- Nearby places can specialize — they don't need to cover all trip types, just complement the anchor.
- Search for current reviews to ensure quality picks.
- No duplicates across any group.

Respond with ONLY valid JSON, no markdown fences. Use this structure:
{
  "clusters": [
    {
      "anchorName": "Name from the list above",
      "nearby": [
        {
          "name": "City/Region, Country",
          "lat": 0.0,
          "lng": 0.0,
          "whyPicked": "Brief reason",
          "tripTypesCovered": ["types"],
          "estimatedDailyCost": "$XX USD",
          "highlights": ["things to do"],
          "reviewSnippet": "What travelers say",
          "nearestParent": "Name of the anchor or nearby place it branches from"
        }
      ]
    }
  ]
}`;

    const result = await this.callGemini(prompt);
    const parsed = this.parseJsonResponse(result);
    const clusterData = parsed.clusters || parsed;

    // Merge with anchor data and validate distances
    return anchors.map((anchor) => {
      const match = (Array.isArray(clusterData) ? clusterData : []).find(
        (c) => c.anchorName === anchor.name
      );

      let nearby = match ? match.nearby || [] : [];

      // Validate distances and add computed distance info
      nearby = nearby
        .filter((p) => {
          // Find the parent (anchor or another nearby place)
          const parent =
            p.nearestParent === anchor.name
              ? anchor
              : nearby.find((n) => n.name === p.nearestParent) || anchor;
          const dist = haversineKm(parent.lat, parent.lng, p.lat, p.lng);
          return dist <= 1000 && dist > 0;
        })
        .map((p) => {
          const parent =
            p.nearestParent === anchor.name
              ? anchor
              : nearby.find((n) => n.name === p.nearestParent) || anchor;
          return {
            ...p,
            distanceFromParent: Math.round(
              haversineKm(parent.lat, parent.lng, p.lat, p.lng)
            ),
            parentName: parent.name,
          };
        })
        .slice(0, 4);

      return {
        anchor,
        nearby,
        allPlaces: [anchor, ...nearby],
      };
    });
  }

  async callGemini(prompt) {
    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }

  parseJsonResponse(text) {
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('[LocationAgent] Failed to parse JSON:', text.substring(0, 300));
      return [];
    }
  }
}

module.exports = LocationAgent;
