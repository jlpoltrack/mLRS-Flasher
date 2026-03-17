# Code Review: ArduPilot Passthrough Refactor
**Commit:** `4349abb` ("better ap passthru")  
**Date:** January 19, 2026

## Summary of Changes
This commit represents a significant and positive refactoring of the ArduPilot passthrough reliability. The primary architectural shift is moving from an **event-driven** model (listeners) to a **queue-based polling** model (`packetQueue`) for handling MAVLink packets. This mimics the synchronous `recv_match` pattern found in Python's `pymavlink` library, greatly simplifying the linear logic required for configuration sequences.

## Findings and Suggestions

### 1. Potential Resource Leak in ESP Reconnect Loop
**Location:** `src/api/ardupilotPassthrough.ts` (approx. line 527)

In the ESP32 reconnection strategy, there is a minor risk of leaving a port locked if an error occurs after connection but before the explicit disconnect.

**Current Implementation:**
```typescript
try {
    await m.connect(57600);
    // ... logic ...
    await m.disconnect(); 
} catch(e) {} // If connect() opens the port but fails later, the port might remain open
```

**Risk:** If `m.connect()` successfully opens the underlying port but throws an error immediately after (e.g., during stream locking), execution jumps to the `catch` block. The port remains "open" in the browser's view, but the `m` wrapper is discarded, potentially causing "Port already open" errors on subsequent attempts.

**Recommendation:**
Ensure `m.disconnect()` is called in the `catch` block or use a `finally` block for that iteration.

```typescript
try {
    await m.connect(57600);
    // ... logic ...
} catch(e) {
    // Ensure cleanup happens even on error
    await m.disconnect().catch(() => {}); 
}
```

### 2. `waitForPacket` Optimization
**Location:** `src/api/ardupilotPassthrough.ts`

Currently, `waitForPacket` loops blindly until the `timeoutMs` expires. If the user cancels the operation or the connection is severed externally, the loop continues unnecessarily.

**Recommendation:**
Add a check for the connection state inside the polling loop to exit early.

```typescript
// Inside waitForPacket loop
while (Date.now() - startTime < timeoutMs) {
    if (!this.readLoopActive) return null; // Exit immediately if disconnected
    
    // ... existing queue check ...
    
    await new Promise(r => setTimeout(r, 10));
}
```

### 3. Type Safety Improvements
**Location:** `waitForMwAck` and `paramRead`

The refactor uses `(packet.payload as any)` in several places to access properties. While pragmatic for the union types of MAVLink packets, it bypasses TypeScript's safety benefits.

**Recommendation:**
Where possible, use `instanceof` checks or type guards to safely narrow the packet payload type before accessing properties, matching the pattern used in the `Heartbeat` check.

### 4. Connection State Management
**Location:** `connect()`

Explicitly recreating `Splitter` and `Parser` instances in `connect()` is a good practice. It ensures no stale partial data from a previous session corrupts the new stream. This pattern should be maintained in future refactors.
