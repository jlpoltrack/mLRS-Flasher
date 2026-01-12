# Tasks

## Research (Completed)
- [x] Analyze `apInitPassthru.py` logic and dependencies
- [x] Analyze invocation in `mLRS_Flasher_cli.py` or Electron main process
- [x] Evaluate Web Serial API capabilities and limitations
- [x] Research JS MAVLink libraries
- [x] Formulate opinion on porting feasibility
- [x] Search for source code of `mlrs.xyz/flash/`
- [x] Identify DFU flashing library
- [x] Answer user question
- [x] Research WebUSB STLink / SWD implementations
- [x] Compare SWD vs DFU web feasibility
- [x] Answer user question
- [x] Identify EdgeTX Buddy flashing mechanism
- [x] Answer user question
- [x] Research `esptool-js` maintenance status
- [x] Research JS MAVLink library options and maintenance
- [x] Compile library summary

## Architecture Design
- [x] Draft `web_architecture.md`
- [x] Research Zadig alternatives for Windows WebUSB
- [x] Incorporate user feedback into architecture doc
- [x] Analyze frontend reusability
- [x] Review and refine architecture with user
- [x] Save architecture document to `docs/web_architecture.md`

## Architecture Review Updates
- [x] Confirm STM32 serial bootloader JS library exists
- [x] Add Error Handling section
- [x] Add Security section
- [x] Add Deployment section
- [x] Note offline flashing is out of scope

## Phase 3: Finalization
- [x] Research testing requirements (localhost/HTTPS)
- [x] Add Testing & Development section to `web_architecture.md`
- [x] Refine GitHub Firmware fetching strategy (Auth vs Raw)
- [x] Incorporate clarified directory structure (Option A)
- [x] Document Tailwind vs CSS Modules discussion
- [x] Add EdgeTX Passthrough workflow
- [x] Refine Lua download workflow details
- [x] Explicitly state internet mandatory requirement
- [x] Final document sign-off

## Implementation Planning
- [x] Create `implementation_plan.md` detailing phases
- [x] Scaffold Project: Initialize `web/` with React + Vite + TypeScript.
    - *Dependencies*: `react`, `react-dom`, `recharts` (for console?), `lucide-react` (icons).
- [x] Port UI Components:
    - Copy/Refactor `Navigation`, `Console`, `FirmwareFlasherPanel` from `electron/src`.
    - Port `app.css`, `panel.css`, etc. (keeping CSS Modules for now).
- [x] **Phase 2: Data Layer (GitHub Integration)**
    - [x] Implement `GithubApi` class/module in `src/api/githubApi.ts`.
    - [x] Implement fetching of `firmware` folder content via GitHub API (or recursive tree fetch).
    - [x] Implement fetching of `devices` list from the repo.
    - [x] Implement `jsDelivr` proxy strategy for raw file downloads.
- [x] Connectivity Verification:
    - [x] Verify "Add Device" button triggers browser permission prompt.
    - [x] Verify device selection populates the list.
    - [x] Integrate `GithubApi` into `useFirmwareLoader` (replacing mock data).
- [x] **Phase 3: Flashing Logic (Web Serial/DFU)**
    - [x] Research and Integrate `esptool-js` for ESP32/ESP8266 targets.
    - [x] Research and Integrate `webdfu` for STM32 DFU targets.
    - [x] Implement STM32 UART bootloader logic via Web Serial (for non-DFU STM32).
    - [x] Create `src/api/flasher.ts` to orchestrate flashing based on metadata.
    - [x] Implement progress reporting from flasher to UI.
    - [x] Verify basic flashing capability with "stub" or real hardware if possible.
