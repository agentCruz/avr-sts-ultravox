/**
 * index.js
 * Entry point for the Ultravox Speech-to-Speech streaming application.
 * This server handles real-time audio streaming between clients and Ultravox's API,
 * performing necessary audio format conversions and WebSocket communication.
 *
 * @author Agent Voice Response <info@agentvoiceresponse.com>
 * @see https://www.agentvoiceresponse.com
 */

const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
require("dotenv").config();

// Initialize Express application
const app = express();

if (!process.env.TENANT_BASE_URL) {
  throw new Error("TENANT_BASE_URL is not set");
}

const TENANT_BASE_URL = process.env.TENANT_BASE_URL || "";

/**
 * Connects to Ultravox API and returns an open WebSocket connection
 * @returns {Promise<WebSocket>} The WebSocket connection to Ultravox
 */
async function connectToUltravox(uuid, from, to) {
  console.log(
    "Connecting to Ultravox API",
    uuid,
    from,
    to
  );
  const response = await axios.post(
    TENANT_BASE_URL,
    {
      from: from || "unknown",
      to: to || "unknown",
      callId: uuid,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const joinUrl = response.data.data.joinUrl;
  if (!joinUrl) {
    throw new Error("Missing Ultravox joinUrl");
  }

  return new WebSocket(joinUrl);
}

/**
 * Handles incoming client audio stream and manages communication with Ultravox's API.
 * Implements buffering for audio chunks received before WebSocket connection is established.
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
const handleAudioStream = async (req, res) => {
  const uuid = req.headers['x-uuid'];
  console.log('Received UUID:', uuid);

  const from = req.headers['x-from'];
  const to = req.headers['x-to'];

  const ultravoxWebSocket = await connectToUltravox(uuid, from, to);

  ultravoxWebSocket.on("open", () => {
    console.log("WebSocket connected to Ultravox");
  });

  let ultravoxChunksQueue = Buffer.alloc(0);
  let isFirstUltravoxChunk = true;
  let ultravoxStartTime = null;


  ultravoxWebSocket.on("message", async (data, isBinary) => {
    if (isBinary) {
      // Handle binary audio data from Ultravox
      if (isFirstUltravoxChunk) {
        ultravoxStartTime = Date.now();
        isFirstUltravoxChunk = false;
        console.log("First Ultravox audio chunk received, starting delay...");
      }

      // Add Ultravox chunk to buffer
      ultravoxChunksQueue = Buffer.concat([ultravoxChunksQueue, data]);

      // If we have accumulated enough time, write the buffer
      if (ultravoxStartTime && Date.now() - ultravoxStartTime >= 100) {
        // Create a copy of the current buffer and reset the original
        const bufferToWrite = ultravoxChunksQueue;
        ultravoxChunksQueue = Buffer.alloc(0);
        
        // Write the buffer to the response
        res.write(bufferToWrite);
      }
    } else {
      // Handle JSON control messages from Ultravox
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "call_started":
          console.log("Call started", message.callId);
          break;

        case "state":
          console.log("State", message.state);
          break;

        case "transcript":
          if (message.final) {
            console.log(
              `${message.role.toUpperCase()} (${message.medium}): ${
                message.text
              }`
            );
          }
          break;

        case "playback_clear_buffer":
          console.log("Playback clear buffer");
          break;

        case "error":
          console.error("Error", message);
          break;

        default:
          console.log("Received message type:", message.type);
          break;
      }
    }
  });

  ultravoxWebSocket.on("close", () => {
    console.log("WebSocket connection closed");
    res.end();
  });

  ultravoxWebSocket.on("error", (err) => {
    console.error("WebSocket error:", err);
    res.end();
  });

  // Handle incoming audio data from client
  req.on("data", async (audioChunk) => {
    if (ultravoxWebSocket.readyState === ultravoxWebSocket.OPEN) {
      ultravoxWebSocket.send(audioChunk);
    }
  });

  req.on("end", () => {
    console.log("Request stream ended");
    ultravoxWebSocket.close();
  });

  req.on("error", (err) => {
    console.error("Request error:", err);
    clearInterval(interval);
    ultravoxWebSocket.close();
  });
};

// Route for speech-to-speech streaming
app.post("/speech-to-speech-stream", handleAudioStream);

const PORT = process.env.PORT || 6031;
app.listen(PORT, async () => {
  console.log(`Ultravox Speech-to-Speech server running on port ${PORT}`);
});
