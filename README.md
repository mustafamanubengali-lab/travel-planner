# Travel Planner (Trippin)

AI-powered travel destination recommender that discovers personalized destinations through conversation. Chat about your trip preferences, and the system finds 5 geographically diverse destination clusters with flight affordability validation.

## How It Works

1. **Chat** - Conversational AI gathers your travel preferences (origin, trip type, budget, group size, dates)
2. **Discover** - Location agent searches globally for 5 anchor destinations >4,000km apart
3. **Validate** - Checks flight affordability across 3 rounds, replacing expensive options with alternatives
4. **Expand** - Finds hidden gems within 1,000km of each anchor (3-4 nearby places per cluster)
5. **Present** - Interactive carousel with destination details, cost estimates, and travel reviews

## Tech Stack

- **Express.js 5** - REST API server
- **Google Gemini 2.5 Flash** (with search tools) - Conversational AI & destination discovery
- **Vanilla HTML/CSS/JS** - Responsive frontend with animations
- **Unsplash API** - Dynamic destination imagery

## Setup

### Prerequisites

- Node.js 14+
- Google Gemini API key ([free tier](https://ai.google.dev/))

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
GEMINI_API_KEY=your-key
PORT=3000
```

### Running

```bash
npm start
```

Open `http://localhost:3000`.

## Features

### Conversational Requirements Gathering
- Natural multi-turn dialogue extracts trip parameters
- Progress indicator shows completion of required fields
- Required: origin, trip types, budget, number of people (dates optional)

### Intelligent Destination Discovery
- **Geographic diversity** - Haversine formula ensures anchors are >4,000km apart
- **Budget-aware** - 3-round flight validation keeps travel costs under 50% of budget
- **Train/drive fallback** - Falls back to nearby alternatives if flights are too expensive
- **Cluster expansion** - Each anchor gets 3-4 complementary nearby destinations

### Smart Caching
- Similarity matching based on origin (500km radius), trip type overlap (50%+), and recency (30 days)
- Rank-weighted selection favors previously chosen destinations
- Weighted random picking balances popularity with variety

### Results Interface
- Destination carousel with cluster visualization
- Modal details with highlights, costs, and reviews
- Selection tracking that improves future recommendations

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/chat` | Send message, receive extracted trip data |
| POST | `/api/discover` | Trigger async location discovery |
| GET | `/api/discover/:sessionId` | Poll for discovery results |
| POST | `/api/rank` | Record user's destination selection |
| POST | `/api/reset` | Clear session data |

## Architecture

```
Chat Interface → Gemini extracts requirements → All fields complete?
    ├─ No → Ask follow-up question
    └─ Yes → Location Agent
        ├─ Check cache for similar searches
        ├─ Fresh search for 5 diverse anchors (if needed)
        ├─ 3-round flight affordability validation
        ├─ Expand with nearby destinations
        ├─ Save to cache
        └─ Return 5 clusters → Results carousel
```

## Project Structure

```
├── server.js                    # Express server & API routes
├── src/
│   ├── agents/
│   │   └── location-agent.js    # Destination discovery logic
│   └── utils/
│       ├── distance.js          # Haversine distance calculations
│       └── search-cache.js      # JSON-based search caching
├── public/
│   ├── index.html / app.js      # Chat interface
│   ├── results.html / results.js # Results carousel
│   └── *.css                    # Styling
├── data/
│   └── search-cache.json        # Persistent destination cache
└── test-agent.js                # Location agent test script
```
