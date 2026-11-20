require("dotenv").config();
const path = require("path");
const express = require("express");
const { formatMenuList, findMenuItemById } = require("./data/menu");
const { getSession, calculateTotal } = require("./store/sessionStore");
const { initializePayment, verifyPayment } = require("./services/paystack");

const app = express();
const PORT = process.env.PORT || 5000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const MAIN_MENU_TEXT = [
  "Welcome! How can I help you today?",
  "Select 1 to Place an order",
  "Select 99 to checkout order",
  "Select 98 to see order history",
  "Select 97 to see current order",
  "Select 0 to cancel order",
].join("\n");

function generateOrderId() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
}

function formatOrderSummary(order) {
  if (!order || order.items.length === 0) {
    return "You currently have no items in your order.";
  }
  const itemLines = order.items.map(
    (item) => `- ${item.name} x${item.qty} (₦${(item.price * item.qty).toLocaleString()})`
  );
  const scheduleLine = order.scheduledFor ? `\nScheduled for: ${order.scheduledFor}` : "";
  return [
    `Order ID: ${order.id} [${order.status.toUpperCase()}]`,
    ...itemLines,
    `Total: ₦${order.total.toLocaleString()}${scheduleLine}`,
  ].join("\n");
}

function resolveDeviceId(req) {
  const fromHeader = req.get("x-device-id");
  const fromBody = req.body && req.body.deviceId;
  const raw = (fromHeader || fromBody || "").toString().trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return cleaned || null;
}

// Initial greeting / options when user lands on chatbot page
app.get("/api/session", (req, res) => {
  const deviceId = resolveDeviceId(req);
  if (!deviceId) {
    return res.status(400).json({ error: "A valid device ID is required." });
  }

  const session = getSession(deviceId);
  return res.json({
    deviceId: session.deviceId,
    reply: MAIN_MENU_TEXT,
    hasCurrentOrder: Boolean(session.currentOrder && session.currentOrder.items.length > 0),
  });
});

// Main chat message endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const deviceId = resolveDeviceId(req);
    if (!deviceId) {
      return res.status(400).json({
        reply: "Missing or invalid device session ID.",
        error: "INVALID_DEVICE_ID",
      });
    }

    const rawMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!rawMessage) {
      return res.status(400).json({
        reply: `Please enter a valid option or message.\n\n${MAIN_MENU_TEXT}`,
      });
    }

    const session = getSession(deviceId);

    // 1. Optional order scheduling step
    if (session.step === "AWAITING_SCHEDULE") {
      if (rawMessage.toLowerCase() === "skip" || rawMessage === "0") {
        session.step = session.currentOrder?.status === "placed" ? "AWAITING_PAYMENT" : "MAIN_MENU";
        return res.json({
          reply: `Okay, skipped scheduling.\n\n${MAIN_MENU_TEXT}`,
        });
      }

      if (!session.currentOrder) {
        session.step = "MAIN_MENU";
        return res.json({
          reply: `No active order found to schedule.\n\n${MAIN_MENU_TEXT}`,
        });
      }

      if (rawMessage.length < 3 || rawMessage.length > 100) {
        return res.json({
          reply: "Please enter a valid time or date (e.g., 'Tomorrow at 1:30 PM'), or type 'skip' to cancel.",
        });
      }

      session.currentOrder.scheduledFor = rawMessage;
      session.step = session.currentOrder.status === "placed" ? "AWAITING_PAYMENT" : "MAIN_MENU";
      return res.json({
        reply: `Got it! Your order (${session.currentOrder.id}) is scheduled for: ${rawMessage}.\n\n${MAIN_MENU_TEXT}`,
      });
    }

    // 2. Global commands: 98 (history), 97 (current order), 0 (cancel order), schedule
    if (rawMessage === "98") {
      if (session.orderHistory.length === 0) {
        return res.json({
          reply: `You have no past orders yet.\n\n${MAIN_MENU_TEXT}`,
        });
      }

      const historyText = session.orderHistory
        .map((ord, idx) => `${idx + 1}. ${formatOrderSummary(ord)}`)
        .join("\n\n");

      return res.json({
        reply: `Your Order History:\n\n${historyText}\n\n${MAIN_MENU_TEXT}`,
      });
    }

    if (rawMessage === "97") {
      if (!session.currentOrder || session.currentOrder.items.length === 0) {
        return res.json({
          reply: `You don't have a current order right now.\n\n${MAIN_MENU_TEXT}`,
        });
      }

      return res.json({
        reply: `${formatOrderSummary(session.currentOrder)}\n\n${MAIN_MENU_TEXT}`,
      });
    }

    if (rawMessage === "0") {
      if (
        session.currentOrder &&
        ["draft", "placed", "awaiting_payment"].includes(session.currentOrder.status)
      ) {
        const cancelledOrder = {
          ...session.currentOrder,
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
        };
        session.orderHistory.unshift(cancelledOrder);
        session.currentOrder = null;
        session.step = "MAIN_MENU";

        return res.json({
          reply: `Your order (${cancelledOrder.id}) has been cancelled.\n\n${MAIN_MENU_TEXT}`,
        });
      }

      session.step = "MAIN_MENU";
      return res.json({
        reply: `There is no active order to cancel.\n\n${MAIN_MENU_TEXT}`,
      });
    }

    if (rawMessage.toLowerCase() === "schedule") {
      if (!session.currentOrder || session.currentOrder.status === "cancelled") {
        return res.json({
          reply: `Please place or start an order first (select 1) before scheduling.\n\n${MAIN_MENU_TEXT}`,
        });
      }
      session.step = "AWAITING_SCHEDULE";
      return res.json({
        reply: "When would you like your order scheduled? (e.g., 'Today at 6:00 PM' or 'Tomorrow at 12:30 PM')",
      });
    }

    // 3. Checkout command: 99
    if (rawMessage === "99") {
      const hasDraftItems =
        session.currentOrder &&
        session.currentOrder.status === "draft" &&
        session.currentOrder.items.length > 0;

      if (!hasDraftItems) {
        session.step = session.currentOrder?.status === "placed" ? "AWAITING_PAYMENT" : "MAIN_MENU";
        return res.json({
          reply: `No order to place.\n\nSelect 1 to Place an order to start a new order.\n\n${MAIN_MENU_TEXT}`,
        });
      }

      session.currentOrder.status = "placed";
      session.step = "AWAITING_PAYMENT";

      return res.json({
        reply: [
          "order placed",
          formatOrderSummary(session.currentOrder),
          "",
          "Ready to pay? Enter your email address to generate a Paystack payment link (e.g., customer@example.com), or type 'schedule' to schedule this order first.",
          "You can also select 1 to place a new order or 0 to cancel.",
        ].join("\n"),
        awaitingPaymentEmail: true,
        order: session.currentOrder,
      });
    }

    // 4. Start or browse menu: 1
    if (rawMessage === "1") {
      if (session.currentOrder && session.currentOrder.status === "placed") {
        session.orderHistory.unshift({
          ...session.currentOrder,
          status: "unpaid / superseded",
        });
        session.currentOrder = null;
      }

      session.step = "BROWSING_MENU";
      return res.json({
        reply: formatMenuList(),
      });
    }

    // 5. If awaiting Paystack email, validate email and initialize transaction
    if (session.step === "AWAITING_PAYMENT" && session.currentOrder) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawMessage)) {
        return res.json({
          reply:
            "That doesn't look like a valid email address. Please enter a valid email (e.g., name@example.com) to pay via Paystack, or select 1, 97, 98, or 0.",
        });
      }

      const reference = `${session.currentOrder.id}-${Date.now()}`;
      session.currentOrder.paystackRef = reference;

      const callbackUrl = `${APP_URL}/api/payments/callback?deviceId=${encodeURIComponent(
        deviceId
      )}&reference=${encodeURIComponent(reference)}`;

      const paystackData = await initializePayment({
        email: rawMessage,
        amountInNaira: session.currentOrder.total,
        reference,
        callbackUrl,
        metadata: {
          deviceId,
          orderId: session.currentOrder.id,
        },
      });

      return res.json({
        reply: [
          `Payment link created for Order ${session.currentOrder.id} (₦${session.currentOrder.total.toLocaleString()}).`,
          "Click the button or link below to complete payment on Paystack:",
          paystackData.authorization_url,
        ].join("\n"),
        paymentUrl: paystackData.authorization_url,
        reference,
      });
    }

    // 6. If browsing menu, add selected item by number
    if (session.step === "BROWSING_MENU") {
      const choice = Number(rawMessage);
      if (!Number.isInteger(choice)) {
        return res.json({
          reply: `Invalid selection. Please enter a menu item number or '0' to return.\n\n${formatMenuList()}`,
        });
      }

      const menuItem = findMenuItemById(choice);
      if (!menuItem) {
        return res.json({
          reply: `Item #${choice} wasn't found. Pick a valid number from the list below:\n\n${formatMenuList()}`,
        });
      }

      if (!session.currentOrder || session.currentOrder.status !== "draft") {
        session.currentOrder = {
          id: generateOrderId(),
          items: [],
          total: 0,
          status: "draft",
          scheduledFor: null,
          paystackRef: null,
          createdAt: new Date().toISOString(),
        };
      }

      const existingItem = session.currentOrder.items.find((i) => i.id === menuItem.id);
      if (existingItem) {
        existingItem.qty += 1;
      } else {
        session.currentOrder.items.push({
          id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          qty: 1,
        });
      }
      session.currentOrder.total = calculateTotal(session.currentOrder.items);

      return res.json({
        reply: [
          `Added ${menuItem.name} (₦${menuItem.price.toLocaleString()}) to your order.`,
          `Current total: ₦${session.currentOrder.total.toLocaleString()}`,
          "",
          "Enter another item number to add more, select '99' to checkout, '97' to view current order, or '0' for main menu.",
        ].join("\n"),
      });
    }

    // 7. Fallback for unrecognized input
    return res.json({
      reply: `I didn't recognize "${rawMessage}". Please choose one of the options below:\n\n${MAIN_MENU_TEXT}`,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({
      reply: "Something went wrong while processing your request. Please try again.",
    });
  }
});

// Paystack callback route -> verifies payment and redirects back to the chatbot UI
app.get("/api/payments/callback", async (req, res) => {
  const reference = typeof req.query.reference === "string" ? req.query.reference.trim() : "";
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim() : "";

  if (!reference) {
    return res.redirect("/?payment=failed&message=Missing+payment+reference");
  }

  try {
    const verification = await verifyPayment(reference);
    const isPaid = verification.status === "success";

    const targetDeviceId =
      deviceId || (verification.metadata && verification.metadata.deviceId) || null;

    if (targetDeviceId) {
      const session = getSession(targetDeviceId);
      if (isPaid && session.currentOrder && session.currentOrder.paystackRef === reference) {
        const paidOrder = {
          ...session.currentOrder,
          status: "paid",
          paidAt: new Date().toISOString(),
        };
        session.orderHistory.unshift(paidOrder);
        session.currentOrder = null;
        session.step = "MAIN_MENU";

        return res.redirect(
          `/?payment=success&orderId=${encodeURIComponent(paidOrder.id)}&amount=${encodeURIComponent(
            paidOrder.total
          )}`
        );
      }
    }

    if (isPaid) {
      return res.redirect(`/?payment=success&reference=${encodeURIComponent(reference)}`);
    }

    return res.redirect(
      `/?payment=failed&message=${encodeURIComponent("Payment was not completed")}`
    );
  } catch (err) {
    console.error("Paystack verification error:", err);
    return res.redirect(
      `/?payment=failed&message=${encodeURIComponent("Unable to verify payment")}`
    );
  }
});

app.listen(PORT, () => {
  console.log(`Restaurant chatbot running at http://localhost:${PORT}`);
});