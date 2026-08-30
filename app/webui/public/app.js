/* Tau WebUI frontend — vanilla JS, no build step. */
const $ = (sel) => document.querySelector(sel);
const messages = $("#messages");

const esc = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function badge(level) {
  return `<span class="badge ${esc(level)}">${esc(level)}</span>`;
}

function addCard(html) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = html;
  messages.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "end" });
  return card;
}

async function loadStatus() {
  try {
    const status = await api("/api/status");
    $("#status-chip").textContent =
      `provider: ${status.provider.name} (${status.provider.source}) · skills: ${status.skills}`;
    $("#home-chip").textContent = status.tauHome;
  } catch (error) {
    $("#status-chip").textContent = `status failed: ${error.message}`;
  }
}

async function loadSkills() {
  const page = $("#tab-skills");
  try {
    const skills = await api("/api/skills");
    page.innerHTML =
      skills.length === 0
        ? '<div class="desc">no skills loaded</div>'
        : skills
            .map(
              (s) =>
                `<div class="skill"><b>${esc(s.name)}</b> ${badge(s.commands ? "low" : "low")} ` +
                `<span class="desc">${esc(s.description)}</span></div>`,
            )
            .join("");
  } catch (error) {
    page.textContent = `failed: ${error.message}`;
  }
}

async function loadHistory() {
  const page = $("#tab-history");
  try {
    const entries = await api("/api/history");
    page.innerHTML =
      entries.length === 0
        ? '<div class="desc">history is empty</div>'
        : entries
            .map(
              (e) =>
                `<div class="hist">` +
                `<span class="${e.status === "ok" ? "s-ok" : "s-other"}">${esc(e.status)}</span> ` +
                `<span class="kind">[${esc(e.kind)}]</span> ${esc(e.intent)}</div>`,
            )
            .join("");
  } catch (error) {
    page.textContent = `failed: ${error.message}`;
  }
}

function renderPlanCard(data) {
  const review = data.review || { overallRisk: "low", issues: [], verdict: "allow" };
  const issues = (review.issues || [])
    .map(
      (i) =>
        `<div class="review-line ${i.level === "blocked" ? "blocked" : ""}">` +
        `${i.level === "blocked" ? "BLOCKED" : "CAUTION"} ${esc(i.message)}</div>`,
    )
    .join("");
  const steps = (data.plan.steps || [])
    .map((s, i) => {
      const what =
        s.kind === "tool"
          ? `tool <b>${esc(s.tool)}</b> ${esc(JSON.stringify(s.args || {}))}`
          : `shell <b>$ ${esc(s.command || "")}</b>`;
      return (
        `<div class="step"><span class="n">${i + 1}.</span>` +
        `<span><span class="cmd">${what}</span>` +
        `${s.reason ? `<div class="reason">${esc(s.reason)}</div>` : ""}</span></div>`
      );
    })
    .join("");
  const denied = review.verdict === "deny";
  const high = review.overallRisk === "high";
  const card = addCard(
    `<div class="intent">plan for “${esc(data.intent)}” ` +
      `${badge(review.overallRisk)} <span class="desc">via ${esc(data.providerLabel || data.provider)}</span></div>` +
      `<div>${steps}</div>` +
      issues +
      (data.warnings || [])
        .map((w) => `<div class="review-line">plugin: ${esc(w)}</div>`)
        .join("") +
      `<div class="actions">` +
      `<button class="run" ${denied ? "disabled" : ""}>Run plan</button>` +
      `<button class="danger discard">Discard</button>` +
      (high && !denied
        ? `<label class="risk-confirm"><input type="checkbox" class="confirm-high" /> high risk — run it</label>`
        : "") +
      `</div>`,
  );
  card.querySelector(".discard").addEventListener("click", () => card.remove());
  card.querySelector(".run").addEventListener("click", () => runPlan(data, card));
  return card;
}

async function runPlan(data, card) {
  const runBtn = card.querySelector(".run");
  const confirmHigh = card.querySelector(".confirm-high")?.checked === true;
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  try {
    const result = await api("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: data.intent,
        plan: data.plan,
        provider: data.provider,
        confirmHighRisk: confirmHigh,
      }),
    });
    const outcomeLines = (result.outcomes || [])
      .map((o, i) => `${i + 1}. [${o.skipped ? "skipped" : o.ok ? "ok" : "failed"}]`)
      .join("\n");
    addCard(
      `<div class="intent">result ${badge(result.status === "ok" ? "ok" : "blocked")}</div>` +
        `<pre class="out">${esc(outcomeLines)}\n\n${esc(result.output || "(no output)")}</pre>`,
    );
  } catch (error) {
    addCard(
      `<div class="intent">execution refused</div><pre class="out">${esc(error.message)}</pre>`,
    );
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Run plan";
    loadHistory();
  }
}

$("#intent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#intent");
  const intent = input.value.trim();
  if (!intent) return;
  input.value = "";
  const card = addCard(
    `<div class="intent">“${esc(intent)}”</div><div class="desc">planning…</div>`,
  );
  try {
    const data = await api("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent }),
    });
    card.remove();
    renderPlanCard(data);
  } catch (error) {
    card.innerHTML =
      `<div class="intent">“${esc(intent)}”</div>` +
      `<div class="review-line blocked">${esc(error.message)}</div>` +
      `<div class="desc">configure a key with \`tau provider set-key\`, or use \`tau config set provider mock\`.</div>`;
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .tab-page").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

loadStatus();
loadSkills();
loadHistory();
