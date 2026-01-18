# TODO: Renaming AP Passthru to ArduPilot Passthrough

## Goal Description
Rename the "AP Passthru" feature to "ArduPilot Passthrough" to align with "INAV Passthrough" naming conventions. This involves updating UI labels and refactoring internal naming to match, ensuring a consistent and clean codebase.

## User Review Required
> [!NOTE]
> I recommend a **Full Refactor** rather than just a cosmetic label change.
> This ensures that the code (`ardupilot_passthrough`) matches the user interface ("ArduPilot Passthrough"), preventing future confusion.
> The "undertaking" is moderate but safe: it involves updating ~5 files.

## Proposed Changes

### Constants & Configuration

#### [MODIFY] [constants.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/constants.ts)
- Rename `FlashMethod.APPassthru` to `FlashMethod.ArduPilotPassthrough`.
- Change value from `'appassthru'` to `'ardupilot_passthrough'`.

#### [MODIFY] [metadata.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/metadata.ts)
- Update all occurrences of `appassthru` string to `ardupilot_passthrough`.
- Update description text `description_ap_passthru_default` to `description_ardupilot_passthrough_default`.

### Web Interface & Logic

#### [MODIFY] [FirmwareFlasherPanel.tsx](file:///Users/jlp/Documents/mLRS-Flasher/web/src/components/FirmwareFlasherPanel.tsx)
- Update usages of `FlashMethod.APPassthru` to `FlashMethod.ArduPilotPassthrough`.
- Update the UI label from "AP Passthru" to "ArduPilot Passthrough".
- Update the legacy programmer string construction if necessary (currently handles `programmer = 'appassthru ...'`).

#### [MODIFY] [flasher.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/flasher.ts)
- Update `FlashMethod.APPassthru` references.
- Update string literal checks against `'appassthru'` to `'ardupilot_passthrough'`.

### File Renaming

#### [RENAME] [apPassthru.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/apPassthru.ts) -> `ardupilotPassthrough.ts`
- Rename the file.
- Rename exported function `initApPassthrough` to `initArduPilotPassthrough`.
- Update imports in `flasher.ts`.

## Verification Plan

### Manual Verification
1.  **Visual Check**: Open the Flasher UI and verify the dropdown option now reads "ArduPilot Passthrough".
2.  **Functionality Check**: Select "ArduPilot Passthrough" and verify:
    - The "Passthrough Serial" dropdown appears.
    - The "Flash" button remains enabled (valid state).
3.  **Code Check**: Verify no lint errors or missing imports after file moves.
