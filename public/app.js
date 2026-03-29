const chatContainer = document.getElementById('chatContainer');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

const sessionId = crypto.randomUUID();

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

function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing';
  div.innerHTML = `<div class="message-content typing">Thinking...</div>`;
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

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
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
        // All required info gathered — show summary state
        sendBtn.textContent = 'Find destinations';
        // TODO: Phase 2 — trigger destination search
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
