"use client";

import { useRef, useState } from "react";
import { OpenAIRealtimeClient } from "@/lib/realtime/openai-realtime-client";

export default function TransportTestPage() {
  const clientRef = useRef<OpenAIRealtimeClient | null>(null);
  const [status, setStatus] = useState("Ready");
  const [testCount, setTestCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);

  const handleTestVoice = async () => {
    try {
      setStatus("Starting...");
      console.log("[TRANSPORT TEST] Button clicked", {
        timestamp: Math.round(performance.now()),
      });

      // Create new client for this test
      const client = new OpenAIRealtimeClient({
        onStateChange: (state) => {
          console.log("[TRANSPORT TEST] State change", { state });
        },
        onError: (error) => {
          console.error("[TRANSPORT TEST] Error", { error });
          setStatus(`Error: ${error}`);
        },
      });

      clientRef.current = client;

      setStatus("Creating session...");
      console.log("[TRANSPORT TEST] Creating session", {
        timestamp: Math.round(performance.now()),
      });

      // Connect to Realtime
      await client.connect();

      setStatus("Verifying transport...");
      console.log("[TRANSPORT TEST] Connection established", {
        isConnected: client.isConnected,
        timestamp: Math.round(performance.now()),
      });

      // Wait a moment for all transport to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      setStatus("Speaking test sentence...");
      console.log("[TRANSPORT TEST] About to speak", {
        timestamp: Math.round(performance.now()),
      });

      // Speak the test sentence
      client.speakExact("Hello Martin. If you can hear this, the transport layer is working.");

      console.log("[TRANSPORT TEST] speakExact() called", {
        timestamp: Math.round(performance.now()),
      });

      // Wait for audio to play (assume 3 seconds is enough)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log("[TRANSPORT TEST] Test complete", {
        timestamp: Math.round(performance.now()),
        success: true,
      });

      setSuccessCount((prev) => prev + 1);
      setStatus(`Success (${successCount + 1}/${testCount + 1})`);
      setTestCount((prev) => prev + 1);

      // Clean up for next test
      client.close();
      clientRef.current = null;
    } catch (error) {
      console.error("[TRANSPORT TEST] Test failed", {
        error: error instanceof Error ? error.message : String(error),
        timestamp: Math.round(performance.now()),
      });
      setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      setTestCount((prev) => prev + 1);

      if (clientRef.current) {
        clientRef.current.close();
        clientRef.current = null;
      }
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Transport Layer Test</h1>

      <div style={styles.statusBox}>
        <p style={styles.statusLabel}>Status:</p>
        <p style={styles.statusValue}>{status}</p>
      </div>

      <div style={styles.resultsBox}>
        <p style={styles.resultsLabel}>Results:</p>
        <p style={styles.resultsValue}>
          {successCount} / {testCount} successful
        </p>
      </div>

      <button onClick={handleTestVoice} style={styles.button}>
        Test Voice
      </button>

      <div style={styles.info}>
        <p>
          <strong>Test Purpose:</strong> Verify that Zeya can reliably speak one predetermined sentence.
        </p>
        <p>
          <strong>Expected Behavior:</strong>
        </p>
        <ul>
          <li>Click button</li>
          <li>Hear English voice speak: "Hello Martin. If you can hear this, the transport layer is working."</li>
          <li>No Spanish</li>
          <li>No autonomous generation</li>
          <li>No transcript processing</li>
        </ul>
        <p>
          <strong>Success Criteria:</strong> Works 10 consecutive times without errors.
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "600px",
    margin: "0 auto",
    padding: "40px 20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  title: {
    textAlign: "center" as const,
    marginBottom: "40px",
    fontSize: "28px",
    fontWeight: "600",
  },
  statusBox: {
    border: "1px solid #ccc",
    borderRadius: "8px",
    padding: "20px",
    marginBottom: "20px",
    backgroundColor: "#f9f9f9",
  },
  statusLabel: {
    margin: "0 0 8px 0",
    fontSize: "14px",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    color: "#666",
  },
  statusValue: {
    margin: "0",
    fontSize: "18px",
    fontWeight: "500",
  },
  resultsBox: {
    border: "1px solid #ccc",
    borderRadius: "8px",
    padding: "20px",
    marginBottom: "20px",
    backgroundColor: "#f9f9f9",
  },
  resultsLabel: {
    margin: "0 0 8px 0",
    fontSize: "14px",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    color: "#666",
  },
  resultsValue: {
    margin: "0",
    fontSize: "18px",
    fontWeight: "500",
  },
  button: {
    display: "block",
    width: "100%",
    padding: "16px",
    fontSize: "16px",
    fontWeight: "600",
    backgroundColor: "#000",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "40px",
    transition: "background-color 0.2s",
  },
  info: {
    fontSize: "14px",
    lineHeight: "1.6",
    color: "#666",
  },
};
