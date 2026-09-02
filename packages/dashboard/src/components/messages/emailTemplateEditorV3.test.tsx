/**
 * @jest-environment jsdom
 */
import {
  ChannelType,
  EmailContentsType,
  MessageTemplateResourceDraft,
} from "isomorphic-lib/src/types";
import React, { act, useState } from "react";
import { createRoot, Root } from "react-dom/client";

import { SetDraft } from "../templateEditor";
import EmailTemplateEditorV3, {
  relativeSavedLabel,
  StableEmailPreview,
} from "./emailTemplateEditorV3";

const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();
const mockCreateTemplate = jest.fn();

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    post: (...args: unknown[]) => mockAxiosPost(...args),
    isCancel: () => false,
  },
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

jest.mock("../../lib/appStore", () => ({
  useAppStorePick: () => ({
    workspace: { type: "Successful", value: { id: "workspace-1" } },
  }),
}));

jest.mock("../../lib/authModeProvider", () => ({
  useAuthHeaders: () => ({}),
  useBaseApiUrl: () => "http://api.test",
}));

jest.mock("../../lib/useAmieComposerConfigQuery", () => ({
  useAmieComposerConfigQuery: () => ({
    data: { enabled: true, imageGenerationEnabled: true },
    isError: false,
  }),
}));

jest.mock("../../lib/useMessageTemplateUpdateMutation", () => ({
  useMessageTemplateUpdateMutation: () => ({
    mutateAsync: (...args: unknown[]) => mockCreateTemplate(...args),
    isPending: false,
  }),
}));

jest.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="User-properties test JSON"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock("./imageAssetsPanel", () => ({
  __esModule: true,
  default: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}));

const initialBody =
  '<html><head><title>Amie</title></head><body><div data-amie-block="0">Original body</div><div>unsubscribe</div></body></html>';

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function button(container: HTMLElement, label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function requiredElement<T extends Element>(
  element: T | null | undefined,
  label: string,
): T {
  if (!element) throw new Error(`Element not found: ${label}`);
  return element;
}

function changeInput(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function pressEnter(
  input: HTMLTextAreaElement,
  options: { shiftKey?: boolean; isComposing?: boolean } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: options.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "isComposing", {
    value: options.isComposing ?? false,
  });
  input.dispatchEvent(event);
}

function composerResponse() {
  return {
    data: {
      subject: "Revised subject",
      previewText: "Revised preview",
      blocks: [{ type: "paragraph", params: { text: "Revised body" } }],
      html: "<html><body>Revised body unsubscribe</body></html>",
      designNotes: "Kept it concise.",
    },
  };
}

function Harness() {
  const [draft, setDraftState] = useState<MessageTemplateResourceDraft>({
    type: ChannelType.Email,
    emailContentsType: EmailContentsType.Code,
    from: "hello@tryamie.com",
    replyTo: "care@tryamie.com",
    subject: "Original subject",
    body: initialBody,
    amieBlocks: [
      { type: "paragraph" as const, params: { text: "Original body" } },
      {
        type: "footer" as const,
        params: { addressLine: "Configured", unsubscribe: "Unsubscribe" },
      },
    ],
  });
  const [title, setTitle] = useState("Refill reminder");
  const [userPropertiesJSON, setUserPropertiesJSON] = useState(
    '{"first_name":"Sarah"}',
  );
  const setDraft: SetDraft = (setter) => setDraftState(setter);

  if (draft.type !== ChannelType.Email || typeof draft.body !== "string") {
    return null;
  }

  return (
    <EmailTemplateEditorV3
      templateId="template-1"
      template={{
        id: "template-1",
        workspaceId: "workspace-1",
        name: title,
        type: ChannelType.Email,
        definition: draft,
        updatedAt: Date.now(),
      }}
      draft={draft}
      setDraft={setDraft}
      disabled={false}
      inDraftView
      title={title}
      setTitle={setTitle}
      rendered={{}}
      userProperties={{ first_name: "Sarah" }}
      userPropertiesJSON={userPropertiesJSON}
      setUserPropertiesJSON={setUserPropertiesJSON}
      publisherStatus={null}
      draftToggleStatus={null}
      viewDraft
      setViewDraft={() => {}}
      lastSavedAt={Date.now()}
      isSaving={false}
      sendTestControl={<button type="button">Send test</button>}
      editorOptions={<button type="button">Options</button>}
      settingsMenu={<button type="button">More settings</button>}
      editorBody={
        <textarea
          aria-label="Code body"
          value={draft.body}
          onChange={(event) =>
            setDraftState((current) =>
              current.type === ChannelType.Email &&
              current.emailContentsType !== EmailContentsType.LowCode
                ? { ...current, body: event.target.value }
                : current,
            )
          }
        />
      }
    />
  );
}

describe("EmailTemplateEditorV3", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockAxiosGet.mockResolvedValue({ data: { assets: [] } });
    mockAxiosPost.mockReset();
    mockCreateTemplate.mockResolvedValue({ id: "created-template" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  it("preserves a code body while switching tabs", () => {
    act(() => root.render(<Harness />));
    act(() => click(button(container, "Code")));
    const codeBody = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Code body"]',
    );
    act(() =>
      changeInput(
        requiredElement(codeBody, "Code body"),
        "<html><body>Hand edited</body></html>",
      ),
    );
    act(() => click(button(container, "Compose")));
    act(() => click(button(container, "Code")));
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Code body"]',
      )?.value,
    ).toBe("<html><body>Hand edited</body></html>");
  });

  it("applies a composer response to subject and body", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        subject: "Time to refill, {{first_name}}",
        previewText: "It takes about a minute.",
        blocks: [{ type: "paragraph", params: { text: "Updated body" } }],
        html: '<html><head><title>Amie</title></head><body><div data-amie-block="0">Updated body</div><div>unsubscribe</div></body></html>',
        designNotes: "Kept it warm and concise.",
      },
    });
    await act(async () => root.render(<Harness />));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Assistant prompt"]',
    );
    act(() =>
      changeInput(
        requiredElement(prompt, "Assistant prompt"),
        "Make it softer",
      ),
    );
    await act(async () => click(button(container, "Send prompt")));
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Subject"]')
        ?.value,
    ).toBe("Time to refill, {{first_name}}");
    expect(
      container
        .querySelector<HTMLIFrameElement>('iframe[title="email-body-preview"]')
        ?.getAttribute("srcdoc"),
    ).toContain("Updated body");
  });

  it("sends the assistant prompt with Enter", async () => {
    mockAxiosPost.mockResolvedValue(composerResponse());
    await act(async () => root.render(<Harness />));
    const prompt = requiredElement(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Assistant prompt"]',
      ),
      "Assistant prompt",
    );
    act(() => changeInput(prompt, "Make it warmer"));

    await act(async () => pressEnter(prompt));

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockAxiosPost.mock.calls[0]?.[1].conversation).toEqual([
      { role: "user", content: "Make it warmer" },
    ]);
  });

  it("does not send the assistant prompt with Shift+Enter", async () => {
    await act(async () => root.render(<Harness />));
    const prompt = requiredElement(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Assistant prompt"]',
      ),
      "Assistant prompt",
    );
    act(() => changeInput(prompt, "First line"));

    act(() => pressEnter(prompt, { shiftKey: true }));

    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("does not send an empty assistant prompt with Enter", async () => {
    await act(async () => root.render(<Harness />));
    const prompt = requiredElement(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Assistant prompt"]',
      ),
      "Assistant prompt",
    );
    act(() => changeInput(prompt, "   \n"));

    act(() => pressEnter(prompt));

    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("does not send the assistant prompt with Enter during IME composition", async () => {
    await act(async () => root.render(<Harness />));
    const prompt = requiredElement(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Assistant prompt"]',
      ),
      "Assistant prompt",
    );
    act(() => changeInput(prompt, "Composed text"));

    act(() => pressEnter(prompt, { isComposing: true }));

    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("sends hand-edited code through the rawHtml revision path", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        subject: "Revised",
        previewText: "Preview",
        blocks: [{ type: "paragraph", params: { text: "Revised" } }],
        html: "<html><body>Revised unsubscribe</body></html>",
        designNotes: "Revised the imported HTML.",
      },
    });
    await act(async () => root.render(<Harness />));
    act(() => click(button(container, "Code")));
    act(() =>
      changeInput(
        requiredElement(
          container.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Code body"]',
          ),
          "Code body",
        ),
        "<html><body>Raw hand edit</body></html>",
      ),
    );
    act(() => click(button(container, "Compose")));
    act(() =>
      changeInput(
        requiredElement(
          container.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Assistant prompt"]',
          ),
          "Assistant prompt",
        ),
        "Tighten this",
      ),
    );
    await act(async () => click(button(container, "Send prompt")));
    expect(mockAxiosPost.mock.calls[0]?.[1].currentBlocks).toEqual([
      {
        type: "rawHtml",
        params: { html: "<html><body>Raw hand edit</body></html>" },
      },
    ]);
  });

  it("round-trips delivery fields and test JSON through Settings", () => {
    act(() => root.render(<Harness />));
    act(() => click(button(container, "Settings")));
    const inputForLabel = (label: string) =>
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
        (input) =>
          input.parentElement?.parentElement?.textContent?.includes(label),
      );
    act(() =>
      changeInput(
        requiredElement(inputForLabel("From"), "From"),
        "new@tryamie.com",
      ),
    );
    act(() =>
      changeInput(
        requiredElement(inputForLabel("Reply-to"), "Reply-to"),
        "reply@tryamie.com",
      ),
    );
    act(() =>
      changeInput(
        requiredElement(inputForLabel("Subject"), "Subject"),
        "Settings subject",
      ),
    );
    const properties = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="User-properties test JSON"]',
    );
    act(() =>
      changeInput(
        requiredElement(properties, "User-properties test JSON"),
        '{"first_name":"Maya"}',
      ),
    );
    act(() => click(button(container, "Compose")));
    act(() => click(button(container, "Settings")));
    expect(inputForLabel("From")?.value).toBe("new@tryamie.com");
    expect(inputForLabel("Reply-to")?.value).toBe("reply@tryamie.com");
    expect(inputForLabel("Subject")?.value).toBe("Settings subject");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="User-properties test JSON"]',
      )?.value,
    ).toBe('{"first_name":"Maya"}');
  });

  it("does not re-render the preview for unrelated parent state", () => {
    const onRender = jest.fn();
    let bump = () => {};
    function PreviewHarness() {
      const [, setTick] = useState(0);
      bump = () => setTick((tick) => tick + 1);
      return (
        <StableEmailPreview
          body="<html><body>Preview</body></html>"
          subject="Stable subject"
          width="desktop"
          onRender={onRender}
        />
      );
    }
    act(() => root.render(<PreviewHarness />));
    expect(onRender).toHaveBeenCalledTimes(1);
    act(() => bump());
    act(() => bump());
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("humanizes saved-time boundaries", () => {
    const now = new Date(2026, 0, 15, 12).getTime();
    const minute = 60_000;
    const hour = 60 * minute;

    expect(relativeSavedLabel(now - minute + 1, false, now)).toBe(
      "Saved just now",
    );
    expect(relativeSavedLabel(now - minute, false, now)).toBe(
      "Saved 1 min ago",
    );
    expect(relativeSavedLabel(now - hour + 1, false, now)).toBe(
      "Saved 59 min ago",
    );
    expect(relativeSavedLabel(now - hour, false, now)).toBe("Saved 1 h ago");
    expect(relativeSavedLabel(now - 24 * hour + 1, false, now)).toBe(
      "Saved 23 h ago",
    );
    expect(relativeSavedLabel(now - 24 * hour, false, now)).toBe(
      "Saved yesterday",
    );
    expect(
      relativeSavedLabel(new Date(2026, 0, 13, 12).getTime(), false, now),
    ).toBe("Saved on Jan 13");
    expect(
      relativeSavedLabel(new Date(2025, 0, 15, 12).getTime(), false, now),
    ).toBe("Saved on Jan 15");
    expect(
      relativeSavedLabel(new Date(2025, 0, 14, 12).getTime(), false, now),
    ).toBe("Saved on Jan 14, 2025");
  });
});
