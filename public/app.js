const chatContainer = document.getElementById('chatContainer');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

const sessionId = crypto.randomUUID();
let discoveryStarted = false;

// Track extracted data
let tripData = {
  location: null,
  tripTypes: null,
  budget: null,
  numberOfPeople: null,
  optionalConstraints: [],
};

function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return div;
}

function addHtmlMessage(html, role) {
  const div = document.createElement('div');
  div.className = `message ${role} wide`;
  div.innerHTML = `<div class="message-content">${html}</div>`;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return div;
}

function addTypingIndicator(text = 'Thinking...') {
  removeTypingIndicator();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing';
  div.innerHTML = `<div class="message-content typing">${escapeHtml(text)}</div>`;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing');
  if (el) el.remove();
}

function updateProgress(extracted) {
  if (!extracted) return;
  tripData = { ...tripData, ...extracted };

  const fields = ['location', 'tripTypes', 'budget', 'numberOfPeople'];
  fields.forEach(field => {
    const el = document.querySelector(`.progress-item[data-field="${field}"]`);
    if (!el) return;
    const value = tripData[field];
    const isFilled = value !== null && value !== undefined &&
      !(Array.isArray(value) && value.length === 0);
    el.classList.toggle('filled', isFilled);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Discovery ---

async function startDiscovery() {
  discoveryStarted = true;
  sendBtn.disabled = true;
  userInput.disabled = true;
  addTypingIndicator('Searching for destinations... this may take a minute');

  try {
    await fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, requirements: tripData }),
    });

    // Poll for results
    pollForResults();
  } catch (err) {
    removeTypingIndicator();
    addMessage('Failed to start destination search. Please try again.', 'assistant');
    sendBtn.disabled = false;
    userInput.disabled = false;
    discoveryStarted = false;
  }
}

async function pollForResults() {
  try {
    const res = await fetch(`/api/discover/${sessionId}`);
    const data = await res.json();

    if (data.status === 'searching') {
      setTimeout(pollForResults, 3000);
      return;
    }

    removeTypingIndicator();

    if (data.status === 'done' && data.clusters) {
      displayClusters(data.clusters);
    } else if (data.status === 'error') {
      addMessage(`Search error: ${data.error}`, 'assistant');
    }

    sendBtn.disabled = false;
    userInput.disabled = false;
  } catch {
    setTimeout(pollForResults, 3000);
  }
}

function displayClusters(clusters) {
  addMessage(`Found ${clusters.length} destination groups for you!`, 'assistant');

  clusters.forEach((cluster, i) => {
    const anchor = cluster.anchor;
    const nearbyHtml = cluster.nearby
      .map(
        (p) => `
        <div class="nearby-place">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="distance">${p.distanceFromParent}km from ${escapeHtml(p.parentName)}</span>
          <p>${escapeHtml(p.whyPicked)}</p>
          <div class="tags">${p.tripTypesCovered.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <p class="cost">${escapeHtml(p.estimatedDailyCost)}/day</p>
        </div>`
      )
      .join('');

    const html = `
      <div class="cluster">
        <div class="cluster-header">
          <h3>Group ${i + 1}: ${escapeHtml(anchor.name)}</h3>
          <span class="cost">${escapeHtml(anchor.estimatedDailyCost)}/day</span>
        </div>
        <p class="why">${escapeHtml(anchor.whyPicked)}</p>
        <div class="tags">${anchor.tripTypesCovered.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="highlights">
          ${anchor.highlights.map((h) => `<span class="highlight">${escapeHtml(h)}</span>`).join('')}
        </div>
        <p class="review">"${escapeHtml(anchor.reviewSnippet)}"</p>
        ${cluster.nearby.length > 0 ? `<div class="nearby-section"><h4>Nearby destinations</h4>${nearbyHtml}</div>` : ''}
      </div>`;

    addHtmlMessage(html, 'assistant');
  });
}

// --- Chat form ---

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // If discovery is ready and user clicks "Find destinations"
  if (sendBtn.textContent === 'Find destinations' && !discoveryStarted) {
    startDiscovery();
    return;
  }

  const text = userInput.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  userInput.value = '';
  sendBtn.disabled = true;
  addTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId }),
    });

    const data = await res.json();
    removeTypingIndicator();

    if (data.error) {
      addMessage('Sorry, something went wrong. Please try again.', 'assistant');
    } else {
      addMessage(data.message, 'assistant');
      updateProgress(data.extracted);

      if (data.complete) {
        sendBtn.textContent = 'Find destinations';
      }
    }
  } catch (err) {
    removeTypingIndicator();
    addMessage('Connection error. Please try again.', 'assistant');
  }

  sendBtn.disabled = false;
  userInput.focus();
});

// Allow Enter to send (Shift+Enter for newline)
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});
