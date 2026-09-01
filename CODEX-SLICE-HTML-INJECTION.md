# Codex work brief: HTML injection path for the Amie composer

## Context
The AI composer (packages/dashboard amieComposer.tsx + packages/api
amieComposerController.ts + isomorphic-lib amieComposer.ts + backend-lib
messaging/amieBlocks.ts) already supports conversational compose/revise over a
brand block schema with live preview. Per SPEC-AI-TEMPLATE-BUILDER.md, the ONE
missing piece is the SECONDARY path: paste raw email HTML and use it directly
as the template body.

## Deliverable
1. In the composer UI (amieComposer.tsx), add an unobtrusive "Paste HTML"
   affordance (secondary — do not compete with the chat-first flow; e.g. a
   small text button under the chat input opening a dialog with a textarea).
2. Submitting pasted HTML:
   - Sanitize CLIENT-AND-SERVER side: strip <script> tags and on* event
     handler attributes; keep everything else verbatim.
   - Non-blocking warnings in the dialog when the HTML lacks an unsubscribe
     merge tag or any {{ }} / {% %} liquid fields.
   - Store it as the template's email body through the SAME save path the
     assembled block output uses (find how the composer persists the assembled
     email to the message template and reuse it; the raw-HTML template must
     render in templatePreview and be usable by broadcasts/journeys exactly
     like any other email template).
3. After injection the block editor does not apply (raw HTML is not blocks):
   show the preview + a notice that this template is raw HTML; the chat may
   still be used ONLY if trivially supportable — otherwise show "AI editing is
   unavailable for pasted HTML" and leave chat disabled for that state. Do NOT
   build HTML->blocks conversion.
4. Server: if a new endpoint is needed, follow amieComposerController.ts
   conventions (TypeBox schemas in isomorphic-lib, schemaValidate, kill-switch
   via existing amieComposerEnabled config, tests co-located).

## WRITABLE SURFACES (hard fence — touch nothing else)
- packages/dashboard/src/components/messages/amieComposer.tsx
- packages/dashboard/src/components/messages/templatePreview.tsx (only if needed)
- packages/isomorphic-lib/src/amieComposer.ts
- packages/api/src/controllers/amieComposerController.ts (+ its .test.ts)
- packages/backend-lib/src/messaging/ (amieComposer/amieBlocks + tests)
- NEW test files alongside the above.

## Definition of done
- `yarn workspace api jest src/controllers/amieComposerController.test.ts` green
- relevant backend-lib tests green; typecheck (`yarn workspace api check`,
  `yarn workspace dashboard check` if it exists) clean on touched packages
- Summarize: files changed, commands run, results, and any UX decisions.
