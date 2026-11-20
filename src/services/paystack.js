const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getSecretKey() {
  return process.env.PAYSTACK_SECRET_KEY || "";
}

async function initializePayment({ email, amountInNaira, reference, callbackUrl, metadata }) {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amountInNaira * 100), // Paystack expects kobo
      reference,
      callback_url: callbackUrl,
      metadata,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to initialize Paystack transaction");
  }

  return data.data; // contains authorization_url, access_code, reference
}

async function verifyPayment(reference) {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    }
  );

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to verify Paystack transaction");
  }

  return data.data;
}

module.exports = {
  initializePayment,
  verifyPayment,
};