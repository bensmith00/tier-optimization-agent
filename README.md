# T.I.E.R. (Telemetry-Informed Execution Routing)
**Autonomous SaaS Optimization Agent via CreateOS & Stripe**

T.I.E.R. is a full-stack, autonomous Site Reliability Engineering (SRE) agent designed to monitor micro-VM telemetry, perform statistical anomaly detection, and dynamically manage user billing subscriptions. 

By leveraging LangGraph orchestration, the system synthesizes custom Python analysis scripts, executes them securely within isolated Firecracker micro-VMs via CreateOS, and seamlessly updates live Stripe subscriptions based on compute usage.

---

## 🏗️ System Architecture

*   **Frontend:** Angular 17+ standalone components styled with Tailwind CSS v3 and daisyUI v4 (custom "cyber" theme). Features real-time dynamic data visualization using Chart.js.
*   **Backend:** Node.js/Express REST API orchestrating a LangGraph state machine.
*   **AI Engine:** OpenAI (`gpt-4o`) for dynamic Z-score Python code synthesis.
*   **Execution Sandbox:** CreateOS Firecracker micro-VMs (`@nodeops-createos/sandbox`) for secure, hardware-isolated code execution.
*   **Billing Engine:** Stripe API for automated subscription tier migrations (Upgrades/Downgrades) with built-in idempotency checks.

---

## 🤝 Human-In-The-Loop (HITL) Architecture

To ensure safe scaling and administrative oversight, T.I.E.R. features a robust Human-in-the-Loop intercept pattern:

*   **UI Toggle Injection:** A "HITL MODE" switch on the Angular dashboard binds to a `requireApproval` boolean, injecting it directly into the LangGraph state via the Express API payload.
*   **Execution Intercept:** When HITL is active, the `stripeBillingAction` node halts execution immediately after the AI Sandbox recommendation is generated, safely pausing the agent before any live Stripe mutations occur.
*   **Manual Approval Override:** The frontend catches the paused execution state and surfaces a browser alert detailing the AI's calculated recommendation. Upon administrative approval, the client dispatches a secondary automated payload to safely bypass the backend guard and finalize the Stripe migration.

---

## ✨ Core AI & Sandbox Features

*   **Autonomous Telemetry Analysis:** The AI agent reads raw compute telemetry (CPU, RAM, API calls) and writes custom, standard-library Python scripts to detect Z-score anomalies (spikes or drops).
*   **Secure Hardware Isolation:** Python logic is base64-encoded and executed inside a disposable CreateOS Firecracker micro-VM to ensure zero risk to the host environment.
*   **Automated Stripe Routing:** The agent parses the VM's standard output (`UPGRADE`, `DOWNGRADE`, or `MAINTAIN`) and routes the corresponding subscription update directly to Stripe.
*   **Dynamic Visualizations:** A responsive dashboard featuring Chart.js to visually map telemetry windows (e.g., Viral Spikes or Churn Risks) in real-time as the agent evaluates them.

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18+ recommended)
*   Angular CLI (`npm install -g @angular/cli`)
*   Active API Keys for OpenAI, Stripe, and CreateOS.

### 1. Environment Configuration
Create a `.env` file in the root directory of the project and add your API keys:
```env
OPENAI_API_KEY=your_openai_api_key
STRIPE_SECRET_KEY=your_stripe_secret_key
CREATEOS_PROJECT_API_KEY=your_createos_api_key
```

### 2. Installation
The project operates as a monorepo containing both the Express backend and the Angular frontend.

**Install Backend Dependencies (Root Directory):**
```bash
npm install
```

**Install Frontend Dependencies (Client Directory):**
```bash
cd client
npm install
```

### 3. Running the Application
You will need two separate terminal windows to run the frontend and backend concurrently.

**Start the Backend Server (Terminal 1 - Root):**
The backend must be run with the `--env-file` flag to securely load the API keys into the Express server and LangGraph nodes.
```bash
node --env-file=.env index.js
```
*(Runs on `http://localhost:3000`)*

**Start the Frontend Client (Terminal 2 - Client):**
```bash
cd client
ng serve
```
*(Runs on `http://localhost:4200`)*

---

## 📊 Evaluation Scenarios

The system reads from a local `telemetry.json` file mimicking live compute windows. The dashboard provides three interactive execution scenarios:

1.  **Steady State:** Normal usage limits. The agent evaluates the metrics, returns a `MAINTAIN` recommendation, and bypasses Stripe.
2.  **Viral Spike:** A sudden, massive surge in API calls and CPU usage. The agent detects a positive Z-score anomaly, returns an `UPGRADE` recommendation, and migrates the Stripe customer to `price_enterprise_3`.
3.  **Churn Risk:** A drastic drop in compute usage approaching zero. The agent detects a negative anomaly, returns a `DOWNGRADE` recommendation, and migrates the Stripe customer to `price_basic_1`.

---

## 🛡️ Idempotency & Safety

*   **Idempotency Checks:** Before executing any Stripe update, the agent queries the user's active subscription. If the target Price ID matches the current Price ID, the migration is cleanly bypassed to prevent duplicate charges.
*   **Resource Management:** The CreateOS sandbox is explicitly destroyed in a `finally` block to prevent dangling micro-VMs and compute overruns, even if the dynamically generated Python script fails.