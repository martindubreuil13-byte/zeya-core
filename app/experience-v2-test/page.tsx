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
      console.log("[TRANSPORT TEST] Creating OpenAIRealtimeClient instance", {
        timestamp: Math.round(performance.now()),
      });

      const client = new OpenAIRealtimeClient({
        onStateChange: (state) => {
          console.log("[TRANSPORT TEST] onStateChange fired", {
            state,
            timestamp: Math.round(performance.now()),
          });
          setStatus(`State: ${state}`);
        },
        onTranscript: (entry) => {
          console.log("[TRANSPORT TEST] UNEXPECTED: onTranscript fired", {
            entry,
            timestamp: Math.round(performance.now()),
          });
        },
        onEvent: (event) => {
          console.log("[TRANSPORT TEST] UNEXPECTED: onEvent fired", {
            eventType: event.type,
            timestamp: Math.round(performance.now()),
          });
        },
        onError: (error) => {
          console.error("[TRANSPORT TEST] Error", { error });
          setStatus(`Error: ${error}`);
        },
      });

      clientRef.current = client;

      console.log("[TRANSPORT TEST] Connecting to Realtime", {
        timestamp: Math.round(performance.now()),
      });

      // Connect to Realtime
      await client.connect();

      console.log("[TRANSPORT TEST] Connected", {
        isConnected: client.isConnected,
        timestamp: Math.round(performance.now()),
      });

      setStatus("Connected, waiting for readiness...");

      // Wait for transport to fully settle
      console.log("[TRANSPORT TEST] Waiting 500ms for transport to settle", {
        timestamp: Math.round(performance.now()),
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log("[TRANSPORT TEST] Ready for speech", {
        isConnected: client.isConnected,
        timestamp: Math.round(performance.now()),
      });

      setStatus("Ready. Speaking sentence...");
      console.log("[TRANSPORT TEST] About to call speakExact()", {
        timestamp: Math.round(performance.now()),
      });

      // Speak the test sentence
      console.log("[TRANSPORT TEST] Calling speakExact() with sentence", {
        sentence: "Hello Martin. If you can hear this, the transport layer is working.",
        timestamp: Math.round(performance.now()),
      });

      client.speakExact("Hello Martin. If you can hear this, the transport layer is working.");

      console.log("[TRANSPORT TEST] speakExact returned", {
        timestamp: Math.round(performance.now()),
      });

      setStatus("Sentence sent. Waiting for playback...");

      // Wait for audio to play
      console.log("[TRANSPORT TEST] Waiting 4 seconds for audio playback", {
        timestamp: Math.round(performance.now()),
      });
      await new Promise((resolve) => setTimeout(resolve, 4000));

      console.log("[TRANSPORT TEST] Audio playback completed", {
        timestamp: Math.round(performance.now()),
      });

      console.log("[TRANSPORT TEST] Test complete - SUCCESS", {
        timestamp: Math.round(performance.now()),
      });

      setSuccessCount((prev) => prev + 1);
      setStatus(`Success (${successCount + 1}/${testCount + 1})`);
      setTestCount((prev) => prev + 1);

      // Clean up for next test
      console.log("[TRANSPORT TEST] Closing connection", {
        timestamp: Math.round(performance.now()),
      });
      client.close();
      clientRef.current = null;
    } catch (error) {
      console.error("[TRANSPORT TEST] Test FAILED with error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
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
