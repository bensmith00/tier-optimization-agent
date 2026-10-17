import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createClient } from "@nodeops-createos/sandbox";
import express from 'express';
import cors from 'cors';

// Initialize external services
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const llm = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0.1 });

// ---------------------------------------------------------
// STATE DEFINITION
// ---------------------------------------------------------
export const AgentState = Annotation.Root({
  scenarioId: Annotation,
  requireApproval: Annotation,
  customerId: Annotation,
  currentTierId: Annotation,
  telemetryWindow: Annotation,
  generatedPythonScript: Annotation,
  sandboxRecommendation: Annotation,
  logs: Annotation({
    reducer: (currentState, newLogs) => currentState.concat(newLogs),
    default: () => [],
  })
});

// ---------------------------------------------------------
// NODES
// ---------------------------------------------------------

// Node 1: Telemetry Ingestion Node
const ingestTelemetry = async (state) => {
  const logUpdate = `INGESTION: Fetching telemetry for scenario: ${state.scenarioId}`;
  console.log("-->", logUpdate);
  
  const filePath = path.join(process.cwd(), 'telemetry.json');
  const rawData = fs.readFileSync(filePath, 'utf-8');
  const datasets = JSON.parse(rawData);
  
  const targetData = datasets.find((d) => d.scenario === state.scenarioId);
  if (!targetData) throw new Error("Scenario not found in telemetry.json");
  
  return {
    customerId: targetData.customerId,
    currentTierId: targetData.currentTierId,
    telemetryWindow: targetData.metrics,
    logs: [logUpdate]
  };
};

// Node 2: Code Generation Node
const generateCode = async (state) => {
  console.log("--> GENERATION: Synthesizing Z-score analysis script...");
  
  // Adjusted prompt to strictly enforce the one-word stdout requirement for Node 3 parsing
  const SYSTEM_PROMPT = `You are an autonomous Site Reliability Engineer. Write a standalone Python 3 script using ONLY Python standard libraries (like json, math, or statistics - do NOT use pandas) to analyze compute telemetry and determine whether the subscription tier should change. (Use Z-scores and anomaly detection, no hardcoded thresholds).

CRITICAL INSTRUCTION: Output ONLY raw, executable Python code. Do not include markdown formatting. The python script MUST print exactly one word to stdout as its final output indicating the decision: "UPGRADE", "DOWNGRADE", or "MAINTAIN".

STATISTICAL DIRECTION: You must evaluate the direction of the anomaly. If the Z-score indicates a significant positive spike (e.g., Z > 2), print "UPGRADE". If the Z-score indicates a significant negative drop (e.g., Z < -2), print "DOWNGRADE". Otherwise, print "MAINTAIN".`;
  
  const humanMessageContent = `Current Tier: ${state.currentTierId}\nTelemetry Data:\n${JSON.stringify(state.telemetryWindow, null, 2)}`;
  
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(humanMessageContent),
  ]);
  
  let rawScript = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  
  const codeBlockMatch = rawScript.match(/```(?:python)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    rawScript = codeBlockMatch[1].trim();
  } else {
    rawScript = rawScript.replace(/^```(?:python)?\n?/i, "").replace(/\n?```$/i, "").trim();
  }
  
  return { 
    generatedPythonScript: rawScript,
    logs: ["CODE_GEN: Script Synthesized"] 
  };
};

// Node 3: Execute Sandbox Node
const runSandbox = async (state) => {
  console.log("--> SANDBOX: Booting Firecracker micro-VM...");
  
  const client = createClient({ apiKey: process.env.CREATEOS_PROJECT_API_KEY });
  const sandbox = await client.createSandbox({ shape: "s-1vcpu-1gb", rootfs: "devbox:1" });
  
  try {
    console.log("--> SANDBOX: Base64 encoding script and injecting into VM...");
    const base64Payload = Buffer.from(state.generatedPythonScript).toString('base64');
    
    await sandbox.runCommand("bash", ["-c", `echo ${base64Payload} | base64 -d > /tmp/analyzer.py`]);
    
    console.log("--> SANDBOX: Executing script...");
    const { result } = await sandbox.runCommand("python3", ["/tmp/analyzer.py"]);
    
    // NEW: Capture and log stderr to expose silent Python crashes
    if (result.stderr) {
      console.error(`    [VM Error]: ${result.stderr.trim()}`);
    }
    
    const rawStdout = result.stdout.trim();
    console.log(`    [VM Output]: ${rawStdout}`);
    
    let recommendation = "MAINTAIN";
    if (rawStdout.includes("UPGRADE")) recommendation = "UPGRADE";
    else if (rawStdout.includes("DOWNGRADE")) recommendation = "DOWNGRADE";
    
    return { 
      sandboxRecommendation: recommendation,
      logs: [`SANDBOX: Execution successful. Recommendation: ${recommendation}`] 
    };
  } catch (error) {
    console.error("VM Execution Error:", error);
    return { sandboxRecommendation: "MAINTAIN", logs: [`SANDBOX ERROR: ${error.message}`] };
  } finally {
    console.log("--> SANDBOX: Destroying micro-VM to prevent billing overruns...");
    await sandbox.destroy();
  }
};

// Node 5: Stripe Billing Action Node
const stripeBillingAction = async (state) => {
  console.log("--> BILLING: Executing Stripe subscription update...");

  const TIER_MAPPINGS = {
    "UPGRADE": "price_enterprise_3",
    "DOWNGRADE": "price_basic_1"
  };

  const targetLookupKey = TIER_MAPPINGS[state.sandboxRecommendation];

  if (!targetLookupKey) {
    return { logs: ["STRIPE ERROR: Invalid recommendation for tier mapping"] };
  }

  // <--- NEW: Human-in-the-Loop Intercept --->
  if (state.requireApproval) {
    console.log(`    [Stripe API]: HITL Intercept Active. Halting migration to ${targetLookupKey}.`);
    return { logs: [`STRIPE: Human-in-the-Loop active... awaiting manual approval to migrate to ${targetLookupKey}.`] };
  }

  if (state.customerId === "cus_DEMO_REPLACE_ME") {
    console.log(`    [Stripe API]: Skipped execution (Mock Customer). Simulated transition to ${targetLookupKey}.`);
    return { logs: [`STRIPE: Simulated migration to ${targetLookupKey} for mock customer.`] };
  }

  try {
    // 1. Resolve the lookup_key into the actual Price ID
    const priceList = await stripe.prices.list({ lookup_keys: [targetLookupKey] });
    if (priceList.data.length === 0) {
      return { logs: [`STRIPE ERROR: Could not find price with lookup_key '${targetLookupKey}'`] };
    }
    const actualTargetPriceId = priceList.data[0].id;

    // 2. Fetch active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: state.customerId,
      status: "active",
      limit: 1
    });

    const activeSub = subscriptions.data[0];
    if (!activeSub) {
      return { logs: ["STRIPE ERROR: No active sub"] };
    }

    const currentPriceId = activeSub.items.data[0].price.id;

    // 3. Execute Idempotency Check using the resolved ID
    if (currentPriceId === actualTargetPriceId) {
      return { logs: ["STRIPE: Idempotency check passed. Migration bypassed."] };
    }

    // 4. Update the subscription with the actual Price ID
    await stripe.subscriptions.update(activeSub.id, {
      items: [{ id: activeSub.items.data[0].id, price: actualTargetPriceId }],
      proration_behavior: "always_invoice",
    });

    console.log(`    [Stripe API]: Live subscription updated to ${targetLookupKey}!`);
    return { logs: ["STRIPE: Successfully migrated"] };
    
  } catch (error) {
    console.error("    [Stripe Error]:", error.message);
    return { logs: [`STRIPE ERROR: ${error.message}`] };
  }
};

// ---------------------------------------------------------
// EDGES & ROUTING
// ---------------------------------------------------------
const routeAfterSandbox = (state) => {
  if (state.sandboxRecommendation === "UPGRADE" || state.sandboxRecommendation === "DOWNGRADE") {
    return "stripeBillingAction";
  }
  return END;
};

// ---------------------------------------------------------
// GRAPH ORCHESTRATION
// ---------------------------------------------------------
const workflow = new StateGraph(AgentState)
  .addNode("ingestTelemetry", ingestTelemetry)
  .addNode("generateCode", generateCode)
  .addNode("runSandbox", runSandbox)
  .addNode("stripeBillingAction", stripeBillingAction)
  
  .addEdge(START, "ingestTelemetry")
  .addEdge("ingestTelemetry", "generateCode")
  .addEdge("generateCode", "runSandbox")
  .addConditionalEdges(
    "runSandbox",
    routeAfterSandbox,
    {
      stripeBillingAction: "stripeBillingAction",
      __end__: END,
    }
  )
  .addEdge("stripeBillingAction", END);

export const agentExecutionApp = workflow.compile();

// ---------------------------------------------------------
// EXPRESS API SERVER
// ---------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/run-agent', async (req, res) => {
  console.log("--> API HIT: Triggering Autonomous Agent...");
  try {
    // Allows the frontend to pass a scenario, defaulting to USAGE_DROP
    //Catch the requireApproval boolean from the frontend 
    const initialState = { 
      scenarioId: req.body.scenarioId || "USAGE_DROP",
      requireApproval: req.body.requireApproval || false 
    };
    const finalState = await agentExecutionApp.invoke(initialState);
    
    console.log("\nFinal Agent State (Logs):", finalState.logs);
    
    res.json({ 
      success: true, 
      message: "Agent execution complete",
      logs: finalState.logs 
    });
  } catch (error) {
    console.error("Agent failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Expose an endpoint to fetch dynamic chart data
app.get('/api/telemetry/:scenarioId', (req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'telemetry.json');
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const datasets = JSON.parse(rawData);
    
    const targetData = datasets.find((d) => d.scenario === req.params.scenarioId);
    if (!targetData) return res.status(404).json({ error: "Scenario not found" });
    
    res.json({ metrics: targetData.metrics });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 TIER Backend API running on http://localhost:${PORT}`));