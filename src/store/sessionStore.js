const sessions = new Map();

function createInitialSession(deviceId) {
  return {
    deviceId,
    step: "MAIN_MENU",
    currentOrder: null, // { id, items: [{ id, name, price, qty }], total, status, scheduledFor, paystackRef, createdAt }
    orderHistory: [],
  };
}

function getSession(deviceId) {
  if (!sessions.has(deviceId)) {
    sessions.set(deviceId, createInitialSession(deviceId));
  }
  return sessions.get(deviceId);
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

module.exports = {
  getSession,
  calculateTotal,
};