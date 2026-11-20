# Restaurant Ordering Chatbot

A backend-driven restaurant ordering chatbot built with **Node.js** and **Express**, featuring device-based sessions (no authentication required), menu ordering, order checkout, order history, order cancellation, optional order scheduling, input validation, and **Paystack** test payment integration.

## Features
- **Device Session Tracking**: Identifies each user/device via a client-generated `x-device-id` stored in `localStorage` without requiring login.
- **Interactive Menu & Commands**:
  - `1` — View menu items and add items by number
  - `99` — Checkout/place current order (or informs you if there is no order to place)
  - `98` — View order history
  - `97` — View current order
  - `0` — Cancel active order (or return to main menu)
  - `schedule` — Optionally schedule an order for a specific date/time
- **Paystack Integration**: Initializes test payments and verifies callbacks before redirecting back to the chat interface with a payment confirmation message.

## How to Run Locally
1. Clone the repository and enter the project folder:
   ```bash
   git clone <your-repo-url>
   cd restaurant-chatbot