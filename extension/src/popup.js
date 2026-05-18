const bindButton = document.getElementById("bind");
const statusElement = document.getElementById("status");

function render(value) {
  statusElement.textContent = JSON.stringify(value, null, 2);
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function refreshStatus() {
  const response = await send({ type: "popup.status" });
  render(response);
}

bindButton.addEventListener("click", async () => {
  bindButton.disabled = true;
  try {
    const response = await send({ type: "popup.bindActiveTab" });
    render(response);
  } catch (error) {
    render({ ok: false, error: String(error.message || error) });
  } finally {
    bindButton.disabled = false;
  }
});

refreshStatus().catch((error) => {
  render({ ok: false, error: String(error.message || error) });
});
