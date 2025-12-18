# Guided Skin Screening UI — Guidelines

Version: 1.0  
Scope: Operator-facing web UI for guided patient screening (portrait → profile → capture → review → analysis → results → reset).  
Principle: Fast, calm, error-resistant, and consistent across repeated sessions.

---

## 1. Core UX Principles

1) **Guided, not exploratory**  
- The system controls the sequence (Face → Arm).  
- The operator should never wonder what to do next.

2) **Prevent cross-patient mistakes**  
- Each session is isolated by Session ID.  
- After Session End, no previous patient data remains visible.

3) **Soft constraints over hard blocks**  
- Skipping an area is allowed, but always warn softly:
  “No images captured for this area. Continue anyway?”

4) **Transparent processing**  
- Analysis page must show progress steps and calm feedback.
- Avoid medical diagnosis wording.

5) **One primary action per screen**  
- Each page has a single dominant CTA.
- Secondary actions are smaller and visually quieter.

---

## 2. Page Structure (IA)

Pages:
1. Ready Screen
2. Portrait Confirm
3. Patient Profile Input
4. Image Capture (Face/Arm template)
5. Review
6. Analysis
7. Results Summary
8. Session End (returns to Ready)

Loop:
Session End → Ready → Next Patient

---

## 3. UI Layout Rules

- Use a single-column layout for clarity (max width 960px).
- Page header:
  - Left: System name
  - Right: Session status (e.g., “Session Active”, “Processing”)
- Main content area uses cards:
  - One primary card per page
  - Secondary cards for grouped content (e.g., area image groups)

Spacing:
- Base spacing unit: 8px
- Typical gaps: 12px, 16px, 24px

---

## 4. Typography

- Default font: system-ui stack
- Sizes:
  - H1: 28–32px (page title)
  - H2: 18–20px (section headings)
  - Body: 14–16px
  - Helper text: 12–13px

Tone:
- Calm, procedural, neutral language
- Avoid diagnosis statements
- Prefer: “Patterns observed” / “Review recommended” / “Follow-up suggested”

---

## 5. Color & Semantics

Use semantic colors only (never decorative meaning):
- Success (Green): “No concerning patterns”
- Warning (Yellow): “Review recommended”
- Danger (Red): “Priority follow-up suggested”
- Neutral (Gray/Blue): default UI

Rules:
- Do not encode critical meaning by color alone.
- Always pair status color with text labels and icons.

---

## 6. Buttons & Interactions

Button hierarchy:
- Primary button: 1 per page (solid fill)
- Secondary button: outline
- Tertiary button: text-only (quiet)

Naming:
- Primary CTAs are verbs:
  - Start New Patient
  - Continue
  - Submit for Analysis
  - End Session

Disable rules:
- During Analysis: all actions disabled.
- During data entry: camera buttons disabled (if applicable).

---

## 7. Capture UI Rules (Image Capture Page)

Required elements:
- Title: “Capture images of FACE/ARM”
- Live preview area (camera feed placeholder if not available)
- Thumbnail strip for current area
- Image counter (e.g., “3 images captured”)
- Progress indicator: Portrait → Face → Arm

Deletion:
- Define deletion behavior explicitly:
  - “Delete Last” or “Delete Selected”
- Always require a short confirmation if deleting multiple images.

Area switching:
- Area is system-controlled:
  - Button 2 (hardware) or UI Next Area advances sequentially.

Soft warnings:
- If moving on with 0 images:
  - Show warning banner + “Continue anyway” / “Go back”

---

## 8. Review Page Rules

- Group images by area with counts.
- Retake flow:
  - Operator selects an area (Face / Arm) to re-enter capture page.
  - Only selected area images are replaced.
- “Submit for Analysis” must lock capture to prevent accidental changes.

---

## 9. Analysis Page Rules

- Non-interactive.
- Show three steps:
  1) Detecting skin regions
  2) Analyzing visual patterns
  3) Aggregating results
- Use a progress bar + spinner (visual reassurance).

---

## 10. Results Page Rules (Non-diagnostic)

Content sections:
1) Overall assessment (traffic-light + label)
2) Area breakdown (thumbnail + confidence + neutral text)
3) Guidance (recommend professional evaluation if needed)

Language constraints:
- No diagnosis: do not name conditions definitively.
- Prefer probability/uncertainty framing:
  - “may benefit from professional evaluation”
  - “patterns observed in images”

---

## 11. Accessibility & Safety

- Minimum touch target: 44x44px
- Keyboard focus visible for all controls
- Provide text labels for status + icons
- Avoid long paragraphs; use short chunks
- Confirm destructive actions (delete many, end session)

---

## 12. Data & Privacy Notes (UI-facing)

- Portrait and patient info are stored internally and linked to Session ID.
- After Session End:
  - UI clears active state
  - No previous patient data remains visible
- Export is optional and explicit (never automatic).

---
