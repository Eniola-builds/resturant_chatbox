const MENU_ITEMS = [
  { id: 1, name: "Jollof Rice & Grilled Turkey", price: 4500 },
  { id: 2, name: "Fried Rice & Peppered Beef", price: 5000 },
  { id: 3, name: "Pounded Yam & Egusi Soup", price: 6000 },
  { id: 4, name: "Ofada Rice & Ayamase Sauce", price: 5500 },
  { id: 5, name: "Mocktail Drink", price: 1500 },
  { id: 6, name: "Bottle Water", price: 1000 },
];

function formatMenuList() {
  const lines = MENU_ITEMS.map(
    (item) => `${item.id}. ${item.name} — ₦${item.price.toLocaleString()}`
  );
  return [
    "Here is our menu. Reply with the item number to add it to your current order, or '0' to go back to the main menu:",
    ...lines,
  ].join("\n");
}

function findMenuItemById(id) {
  return MENU_ITEMS.find((item) => item.id === id) || null;
}

module.exports = {
  MENU_ITEMS,
  formatMenuList,
  findMenuItemById,
};