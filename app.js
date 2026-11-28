/**
 * Apex AI Solutions — Customer Chat UI
 * Voice & Text-Controlled AI Appointment Agent
 * XSS-Safe: textContent only for user/model/API text. Never innerHTML for data.
 *
 * NOTE: getUserMedia requires a secure context (localhost or HTTPS).
 * On plain HTTP origins other than localhost the browser blocks mic access.
 * Text chat continues to work normally in that case.
 */

document.addEventListener("DOMContentLoaded", () => {
  // =========================================================================
  // DOM refs
  // =========================================================================
  const chatMessages    = document.getElementById("chatMessages");
  const chatForm        = document.getElementById("chatForm");
  const messageInput    = document.getElementById("messageInput");
  const typingIndicator = document.getElementById("typingIndicator");
  const escalationBanner = document.getElementById("escalationBanner");
  const voiceBtn        = document.getElementById("voiceBtn");
  const recordingStatus = document.getElementById("recordingStatus");
  const recordingTimer  = document.getElementById("recordingTimer");
  const sendBtn         = document.getElementById("sendBtn");
  const statusBadge     = document.getElementById("statusBadge");
  const statusText      = document.getElementById("statusText");
  const heroCard        = document.getElementById("heroCard");

  // Quick-action buttons
  const qaBook       = document.getElementById("qaBook");
  const qaSlots      = document.getElementById("qaSlots");
  const qaCancel     = document.getElementById("qaCancel");
  const qaReschedule = document.getElementById("qaReschedule");
  const servicePills = document.getElementById("servicePills");

  // Slot picker
  const slotPicker    = document.getElementById("slotPicker");
  const slotDateInput = document.getElementById("slotDateInput");
  const slotCheckBtn  = document.getElementById("slotCheckBtn");
  const slotChips     = document.getElementById("slotChips");

  // =========================================================================
  // Session storage
  // =========================================================================
  const SESSION_KEY = "appointment_agent_session_id";
  let sessionId = sessionStorage.getItem(SESSION_KEY);

  // =========================================================================
  // Hero card — hide once first user message is sent
  // =========================================================================
  let heroHidden = false;

  function hideHero() {
    if (!heroHidden && heroCard) {
      heroCard.style.display = "none";
      heroCard.setAttribute("aria-hidden", "true");
      heroHidden = true;
    }
  }

  // =========================================================================
  // Health check (with 5s timeout so badge never hangs on "Checking...")
  // =========================================================================
  async function checkHealth() {
    if (!statusBadge || !statusText) return;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
    try {
      const r = await fetch("/health", {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      });
      if (!r.ok) {
        statusBadge.className = "status-badge offline";
        statusText.textContent = "Offline";
        return;
      }
      const d = await r.json();
      if (d && d.status === "healthy") {
        statusBadge.className = "status-badge online";
        statusText.textContent = "Online";
      } else {
        statusBadge.className = "status-badge offline";
        statusText.textContent = "Offline";
      }
    } catch {
      statusBadge.className = "status-badge offline";
      statusText.textContent = "Offline";
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  checkHealth();

  // =========================================================================
  // Utilities
  // =========================================================================
  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function formatTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /** Convert "13:00" → "1:00 PM", "09:30" → "9:30 AM" */
  function formatTo12h(t) {
    const [h, m] = t.split(":").map(Number);
    const ampm = h < 12 ? "AM" : "PM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  /** Build the assistant avatar element (inline SVG, no external images) */
  function makeAssistantAvatar() {
    const av = document.createElement("div");
    av.className = "assistant-avatar";
    av.setAttribute("aria-hidden", "true");
    // Robot face SVG — matches hero avatar, scaled for 30px circle
    av.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 2a4 4 0 0 1 4 4v2H8V6a4 4 0 0 1 4-4z"/>' +
      '<rect x="4" y="8" width="16" height="12" rx="3"/>' +
      '<circle cx="9" cy="14" r="1.5" fill="white" stroke="none"/>' +
      '<circle cx="15" cy="14" r="1.5" fill="white" stroke="none"/>' +
      '</svg>';
    return av;
  }

  /**
   * Safely append a text message bubble.
   * CRITICAL XSS DEFENSE: uses textContent for ALL user/model/API text.
   * Returns the bubble div so caller can append extra elements.
   */
  function appendMessage(sender, text) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${sender}`;

    if (sender === "assistant") {
      wrapper.appendChild(makeAssistantAvatar());
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const textEl = document.createElement("p");
    textEl.className = "message-text";
    textEl.textContent = text; // Safe — never innerHTML

    const timeEl = document.createElement("span");
    timeEl.className = "message-time";
    timeEl.textContent = formatTime();

    bubble.appendChild(textEl);
    bubble.appendChild(timeEl);
    wrapper.appendChild(bubble);
    chatMessages.appendChild(wrapper);

    scrollToBottom();
    return bubble;
  }

  /**
   * Add a replay button (SVG play icon, no emoji) to an assistant bubble.
   * XSS-safe: button text is a static string, audio data never rendered as HTML.
   */
  function addReplayButton(bubble, audioB64, mime) {
    if (!audioB64) return;
    const btn = document.createElement("button");
    btn.className = "btn-replay";
    btn.type = "button";
    btn.setAttribute("aria-label", "Replay voice response");

    // Inline SVG play icon
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
      '<polygon points="5,3 19,12 5,21"/>' +
      "</svg>";
    btn.appendChild(icon);

    const label = document.createElement("span");
    label.textContent = "Replay";
    btn.appendChild(label);

    btn.addEventListener("click", () => playBase64Audio(audioB64, mime));
    bubble.appendChild(btn);
  }

  /** Play base64 MP3 audio */
  function playBase64Audio(b64, mime) {
    try {
      const audio = new Audio(`data:${mime || "audio/mpeg"};base64,${b64}`);
      audio.play().catch(() => {});
    } catch (_) {}
  }

  /** Fallback: browser speechSynthesis when no audio_base64 */
  function speakFallback(text) {
    if (!window.speechSynthesis || !text) return;
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.0;
    window.speechSynthesis.speak(utt);
  }

  /**
   * Safely append a booking confirmation card.
   * CRITICAL XSS DEFENSE: all fields set via textContent only.
   */
  function appendBookingCard(booking) {
    if (!booking || !booking.reference_code) return;

    const card = document.createElement("div");
    card.className = "booking-card";

    // Header row
    const header = document.createElement("div");
    header.className = "booking-card-header";

    const title = document.createElement("span");
    title.className = "booking-title";
    title.textContent = "Appointment Confirmed";

    const badge = document.createElement("span");
    badge.className = "booking-ref-badge";
    badge.textContent = booking.reference_code; // textContent — XSS safe

    header.appendChild(title);
    header.appendChild(badge);
    card.appendChild(header);

    function createRow(labelStr, valStr) {
      const row = document.createElement("div");
      row.className = "booking-detail-row";

      const lbl = document.createElement("span");
      lbl.className = "booking-label";
      lbl.textContent = labelStr;

      const val = document.createElement("span");
      val.className = "booking-val";
      val.textContent = valStr; // textContent — XSS safe

      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    }

    if (booking.service_type)    card.appendChild(createRow("Service",          booking.service_type));
    if (booking.date)            card.appendChild(createRow("Date",             booking.date));
    if (booking.time_slot)       card.appendChild(createRow("Time",             booking.time_slot));
    if (booking.rescheduled_from) card.appendChild(createRow("Rescheduled From", booking.rescheduled_from));

    chatMessages.appendChild(card);
    scrollToBottom();
  }

  /** Show/hide typing dots */
  function showTyping(show) {
    typingIndicator.style.display = show ? "flex" : "none";
    if (show) scrollToBottom();
  }

  /** Lock/unlock all inputs during a request */
  function setInputsLocked(locked) {
    messageInput.disabled = locked;
    sendBtn.disabled      = locked;
    voiceBtn.disabled     = locked;
    if (servicePills) {
      servicePills.querySelectorAll(".service-pill").forEach((pill) => {
        pill.disabled = locked;
      });
    }
  }

  /** User-friendly error messages for HTTP error codes */
  function handleErrorStatus(status, headers) {
    if (status === 429) {
      const retryAfter = (headers && headers.get("Retry-After")) || 5;
      return `You are sending messages too quickly. Please wait ${retryAfter} seconds and try again.`;
    }
    if (status === 400)  return "I could not process that input. Please try again.";
    if (status === 422)  return "I could not hear that clearly. Please speak again or type your message.";
    return "A server error occurred. Please try again.";
  }

  // =========================================================================
  // Send a text message through /chat
  // =========================================================================
  async function sendMessage(text) {
    if (!text) return;

    hideHero();
    appendMessage("user", text);
    setInputsLocked(true);
    showTyping(true);

    try {
      const payload = { message: text };
      if (sessionId) payload.session_id = sessionId;

      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      showTyping(false);

      if (!response.ok) {
        appendMessage("assistant", handleErrorStatus(response.status, response.headers));
        return;
      }

      const data = await response.json();

      if (data.session_id) {
        sessionId = data.session_id;
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }

      appendMessage("assistant", data.reply || "");
      if (data.booking) appendBookingCard(data.booking);
      escalationBanner.style.display = data.escalated ? "flex" : "none";

    } catch (_) {
      showTyping(false);
      appendMessage("assistant", "Network connection lost. Please check your connection and try again.");
    } finally {
      setInputsLocked(false);
    }
  }

  // =========================================================================
  // Text chat form submit
  // =========================================================================
  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rawText = messageInput ? messageInput.value.trim() : "";
      if (!rawText) return;
      messageInput.value = "";
      messageInput.focus();
      await sendMessage(rawText);
    });
  }

  // =========================================================================
  // 5 Service Pills — mark active and start live /chat flow
  // =========================================================================
  if (servicePills) {
    const pillButtons = Array.from(servicePills.querySelectorAll(".service-pill"));
    pillButtons.forEach((pill) => {
      pill.addEventListener("click", async (e) => {
        const targetPill = e.currentTarget || (e.target && e.target.closest(".service-pill"));
        if (!targetPill || targetPill.disabled) return;
        const serviceName = targetPill.getAttribute("data-service");
        if (!serviceName) return;

        pillButtons.forEach((btn) => {
          const isSelected = btn === targetPill;
          btn.classList.toggle("active", isSelected);
          btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
        });

        hideHero();
        await sendMessage(`I'd like to book an appointment for ${serviceName}.`);
      });
    });
  }

  // =========================================================================
  // Quick-action pill handlers
  // =========================================================================
  if (qaBook) {
    qaBook.addEventListener("click", () => {
      if (!messageInput) return;
      messageInput.value = "I want to book an appointment";
      messageInput.focus();
    });
  }

  if (qaCancel) {
    qaCancel.addEventListener("click", () => {
      if (!messageInput) return;
      messageInput.value = "I want to cancel my appointment";
      messageInput.focus();
    });
  }

  if (qaReschedule) {
    qaReschedule.addEventListener("click", () => {
      if (!messageInput) return;
      messageInput.value = "I want to reschedule my appointment";
      messageInput.focus();
    });
  }

  // Check Slots — toggle the date picker panel
  qaSlots.addEventListener("click", () => {
    const isOpen = slotPicker.style.display !== "none";
    if (isOpen) {
      slotPicker.style.display = "none";
      qaSlots.classList.remove("active");
      qaSlots.setAttribute("aria-expanded", "false");
    } else {
      // Pre-fill date input with tomorrow, min = today
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const toIso = (d) => d.toISOString().split("T")[0];
      slotDateInput.min   = toIso(today);
      slotDateInput.value = toIso(tomorrow);

      slotPicker.style.display = "flex";
      qaSlots.classList.add("active");
      qaSlots.setAttribute("aria-expanded", "true");
      slotDateInput.focus();
    }
  });

  // =========================================================================
  // Slot picker — fetch /slots/{date} and render chips
  // =========================================================================
  slotCheckBtn.addEventListener("click", async () => {
    const dateStr = slotDateInput.value;
    if (!dateStr) return;

    // Clear previous chips
    slotChips.innerHTML = "";

    const loadingEl = document.createElement("span");
    loadingEl.className = "slot-info-text";
    loadingEl.textContent = "Loading slots...";
    slotChips.appendChild(loadingEl);

    try {
      const r = await fetch(`/slots/${dateStr}`, { cache: "no-store" });
      const d = await r.json();

      slotChips.innerHTML = ""; // clear loading msg

      if (!r.ok || !d.success) {
        const err = document.createElement("span");
        err.className = "slot-info-text";
        err.textContent = d.message || "Could not load slots for this date.";
        slotChips.appendChild(err);
        return;
      }

      const slots = (d.data && d.data.slots) || [];

      if (slots.length === 0) {
        const none = document.createElement("span");
        none.className = "slot-info-text";
        none.textContent = "No slots available for this date.";
        slotChips.appendChild(none);
        return;
      }

      // Count available
      const availableCount = slots.filter((s) => s.available).length;
      if (availableCount === 0) {
        const none = document.createElement("span");
        none.className = "slot-info-text";
        none.textContent = "All slots are booked for this date. Please choose another day.";
        slotChips.appendChild(none);
        return;
      }

      // Render a chip per slot
      slots.forEach((slot) => {
        const formatted = formatTo12h(slot.time);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.setAttribute("role", "listitem");

        if (slot.available) {
          chip.className = "slot-chip";
          chip.setAttribute("aria-label", `Book the ${formatted} slot`);
          chip.textContent = formatted; // textContent — XSS safe
          chip.addEventListener("click", () => {
            // Send through normal /chat flow
            const msg = `I'd like the ${formatted} slot on ${dateStr}`;
            messageInput.value = "";
            // Hide slot picker
            slotPicker.style.display = "none";
            qaSlots.classList.remove("active");
            qaSlots.setAttribute("aria-expanded", "false");
            sendMessage(msg);
          });
        } else {
          chip.className = "slot-chip unavailable";
          chip.disabled = true;
          chip.setAttribute("aria-disabled", "true");
          chip.setAttribute("aria-label", `${formatted} — unavailable`);
          chip.textContent = formatted; // textContent — XSS safe
        }

        slotChips.appendChild(chip);
      });

    } catch (_) {
      slotChips.innerHTML = "";
      const err = document.createElement("span");
      err.className = "slot-info-text";
      err.textContent = "Network error. Could not load slots.";
      slotChips.appendChild(err);
    }
  });

  // =========================================================================
  // Voice Recording Pipeline
  // =========================================================================
  let mediaRecorder = null;
  let audioChunks   = [];
  let recordingTimerInterval = null;
  let recordingSeconds = 0;
  const MAX_RECORDING_SECONDS = 30;

  /** Choose best supported MIME type for recording */
  function chooseMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg",
    ];
    for (const mt of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) {
        return mt;
      }
    }
    return "";
  }

  function mimeToExt(mime) {
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mp4")) return "mp4";
    return "webm";
  }

  function startRecordingTimer() {
    recordingSeconds = 0;
    recordingTimer.textContent = "0:00";
    recordingStatus.style.display = "flex";
    recordingTimerInterval = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60);
      const s = String(recordingSeconds % 60).padStart(2, "0");
      recordingTimer.textContent = `${m}:${s}`;
      if (recordingSeconds >= MAX_RECORDING_SECONDS) stopRecording();
    }, 1000);
  }

  function stopRecordingTimer() {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
    recordingStatus.style.display = "none";
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      appendMessage("assistant", "Voice recording is not supported in this browser. Please type your message instead.");
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        appendMessage("assistant", "Microphone access was denied. Please allow mic permission in your browser settings. You can still type your messages.");
      } else {
        appendMessage("assistant", "Could not access your microphone. Please check your device settings and try again.");
      }
      return;
    }

    const mimeType = chooseMimeType();
    const options  = mimeType ? { mimeType } : {};
    try {
      mediaRecorder = new MediaRecorder(stream, options);
    } catch (_) {
      mediaRecorder = new MediaRecorder(stream);
    }

    audioChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((t) => t.stop());
      stopRecordingTimer();
      const finalMime = mediaRecorder.mimeType || mimeType || "audio/webm";
      const ext  = mimeToExt(finalMime);
      const blob = new Blob(audioChunks, { type: finalMime });
      await sendVoiceBlob(blob, ext);
    });

    mediaRecorder.start();
    voiceBtn.classList.add("recording");
    voiceBtn.setAttribute("aria-label", "Stop recording");
    voiceBtn.title = "Click to stop recording";
    startRecordingTimer();
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    voiceBtn.classList.remove("recording");
    voiceBtn.setAttribute("aria-label", "Record voice message");
    voiceBtn.title = "Click to record voice message";
  }

  /** Send recorded audio blob to /voice-chat */
  async function sendVoiceBlob(blob, ext) {
    hideHero();
    setInputsLocked(true);
    showTyping(true);

    try {
      const formData = new FormData();
      formData.append("audio", blob, `recording.${ext}`);
      if (sessionId) formData.append("session_id", sessionId);

      const response = await fetch("/voice-chat", {
        method: "POST",
        body: formData,
      });

      showTyping(false);

      if (!response.ok) {
        appendMessage("assistant", handleErrorStatus(response.status, response.headers));
        return;
      }

      const data = await response.json();

      if (data.session_id) {
        sessionId = data.session_id;
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }

      // Show transcript as user bubble
      if (data.transcript) appendMessage("user", data.transcript);

      // Show assistant reply + optional replay button
      const replyText = data.reply || "";
      const bubble    = appendMessage("assistant", replyText);

      if (data.audio_base64) {
        playBase64Audio(data.audio_base64, data.audio_mime || "audio/mpeg");
        addReplayButton(bubble, data.audio_base64, data.audio_mime || "audio/mpeg");
      } else if (replyText) {
        speakFallback(replyText);
      }

      if (data.booking) appendBookingCard(data.booking);
      escalationBanner.style.display = data.escalated ? "flex" : "none";

    } catch (_) {
      showTyping(false);
      appendMessage("assistant", "Network connection lost. Please check your connection and try again.");
    } finally {
      setInputsLocked(false);
    }
  }

  // Toggle recording on mic button click
  voiceBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      startRecording();
    }
  });

});
