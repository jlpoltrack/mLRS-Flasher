export type FlasherState =
  | 'IDLE'
  | 'CONNECTING' // Connecting to port / Initializing
  | 'SYNCING'    // Bootloader synchronization
  | 'ERASING'    // Erasing flash memory
  | 'WRITING'    // Writing firmware
  | 'VERIFYING'  // Optional verification step
  | 'RESETTING'  // Rebooting device
  | 'DONE'       // Success
  | 'ERROR';     // Failure

export class FlasherStateMachine {
  private state: FlasherState = 'IDLE';
  private onProgress?: (progress: number, status: string) => void;
  private onLog?: (message: string) => void;

  // valid state transitions for debugging
  private static readonly validTransitions: Record<FlasherState, FlasherState[]> = {
    'IDLE': ['CONNECTING', 'ERROR'],
    'CONNECTING': ['SYNCING', 'ERASING', 'WRITING', 'ERROR'], // some protocols skip syncing
    'SYNCING': ['ERASING', 'WRITING', 'ERROR'],
    'ERASING': ['WRITING', 'ERROR'],
    'WRITING': ['VERIFYING', 'RESETTING', 'DONE', 'ERROR'],
    'VERIFYING': ['RESETTING', 'DONE', 'ERROR'],
    'RESETTING': ['DONE', 'ERROR'],
    'DONE': ['IDLE'], // reset for next flash
    'ERROR': ['IDLE'], // reset for retry
  };

  constructor(
      onProgress?: (progress: number, status: string) => void,
      onLog?: (message: string) => void
  ) {
    this.onProgress = onProgress;
    this.onLog = onLog;
  }

  /**
   * Transition to a new state and update UI.
   */
  transition(newState: FlasherState, details?: string) {
    // validate transition in development
    const validNext = FlasherStateMachine.validTransitions[this.state];
    if (validNext && !validNext.includes(newState)) {
      console.warn(`[FlasherStateMachine] Unexpected transition: ${this.state} -> ${newState}`);
    }

    this.state = newState;
    const msg = details || this.readableState(newState);
    
    // log the transition
    this.log(`State -> ${newState} (${msg})`);
    
    // update progress bar status text (keep percentage same or reset based on state)
    this.updateProgressStatus(msg);

    if (newState === 'DONE') {
        this.onProgress?.(100, 'Complete');
    }
  }

  /**
   * Update progress percentage and optional status text.
   */
  updateProgress(percent: number, status?: string) {
    this.onProgress?.(percent, status || this.readableState(this.state));
  }

  /**
   * Helper to log messages with current state context.
   */
  log(message: string) {
    this.onLog?.(message);
  }

  /**
   * Update the status text without changing percentage
   */
  private updateProgressStatus(status: string) {
      // We don't have the current percentage stored easily without making this stateful of percentage too.
      // For now, let's just emit the status. The UI handles (percentage, status).
      // If we want to preserve percentage, we might need to track it.
      // But typically state transitions happen at 0% or undefined progress points usually.
      // Lets assume 0 for new states generally, except DONE which is 100.
      
      let percent = 0;
      if (this.state === 'DONE') percent = 100;
      // For other states, we might not want to reset to 0 if we are in the middle of something,
      // but 'transition' usually implies a new phase.
      
      this.onProgress?.(percent, status);
  }

  private readableState(state: FlasherState): string {
      switch (state) {
          case 'CONNECTING': return 'Connecting';
          case 'SYNCING': return 'Syncing';
          case 'ERASING': return 'Erasing Flash';
          case 'WRITING': return 'Flashing Firmware';
          case 'VERIFYING': return 'Verifying';
          case 'RESETTING': return 'Resetting Device';
          case 'DONE': return 'Success';
          case 'ERROR': return 'Error';
          default: return state;
      }
  }
}
