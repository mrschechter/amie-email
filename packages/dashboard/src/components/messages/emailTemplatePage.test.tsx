/**
 * @jest-environment jsdom
 */
/**
 * Page-level: the real email template page (EmailEditor → TemplateEditor's
 * draft/published flow → EmailTemplateEditorV3), with the API faked at the
 * axios layer and only the GrapesJS canvas replaced by a stub that reports
 * whether it is editable.
 *
 * Nicholate 2026-10-29 (after #65): no template was editable. Older
 * imported templates had their visual editor buttons disabled, visual
 * templates opened read-only ("Viewing the published version — switch to
 * the draft to edit.") with no visible way to switch. Cause: `viewDraft` is
 * app-wide state that the journey editor sets to false for published
 * journeys, and the visual editor treated `!viewDraft` as read-only even when
 * the template had no draft.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { enableMapSet } from "immer";
import {
  ChannelType,
  CompletionStatus,
  EmailContentsType,
  MessageTemplateResource,
} from "isomorphic-lib/src/types";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { TextDecoder, TextEncoder } from "util";

import { initializeStore, Provider as StoreProvider } from "../../lib/appStore";
import EmailEditor from "./emailEditor";

enableMapSet();

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
Object.assign(globalThis, { TextDecoder, TextEncoder });

/* ---------------------------- fake API ---------------------------- */

/** The template as the fake API stores and returns it. */
let template: Record<string, unknown> & { id: string };
const puts: Record<string, unknown>[] = [];

function respond(data: unknown) {
  return Promise.resolve({ data });
}

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: (url: string) => {
      if (url.endsWith("/content/templates")) {
        return respond({ templates: [template] });
      }
      if (url.endsWith("/user-properties")) {
        return respond({ userProperties: [] });
      }
      if (url.endsWith("/compose/config")) return respond({ enabled: false });
      return respond({ assets: [] });
    },
    put: (url: string, body: Record<string, unknown>) => {
      if (url.endsWith("/content/templates")) {
        puts.push(body);
        const next: Record<string, unknown> = { ...template };
        if ("draft" in body) {
          next.draft = body.draft === null ? undefined : body.draft;
        }
        if (body.definition) next.definition = body.definition;
        next.updatedAt = Date.now();
        template = { ...next, id: template.id };
        return respond(template);
      }
      return respond({});
    },
    post: () =>
      respond({
        contents: {
          body: { type: "Ok", value: "<p>preview</p>" },
          subject: { type: "Ok", value: "Subject" },
          from: { type: "Ok", value: "hello@tryamie.com" },
        },
      }),
    isCancel: () => false,
    isAxiosError: () => false,
  },
}));

jest.mock("next/router", () => {
  const router = {
    query: {},
    pathname: "/templates/email/[id]",
    asPath: "/templates/email/x",
    push: () => Promise.resolve(true),
    replace: () => Promise.resolve(true),
    prefetch: () => Promise.resolve(),
    events: { on: () => {}, off: () => {}, emit: () => {} },
    isReady: true,
  };
  return { __esModule: true, useRouter: () => router, default: router };
});

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

// next/dynamic → the (stubbed) module, synchronously
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    require("./visualEmail/visualEmailEditor").default,
}));

/** The GrapesJS canvas, reduced to what the page decides about it. */
jest.mock("./visualEmail/visualEmailEditor", () => ({
  __esModule: true,
  default: ({
    disabled,
    onEditDraft,
    setDraft,
  }: {
    disabled?: boolean;
    onEditDraft?: () => void;
    setDraft: (update: (d: { body: string }) => { body: string }) => void;
  }) => (
    <div data-testid="visual-stub" data-disabled={String(Boolean(disabled))}>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          setDraft((d) => ({ ...d, body: `${d.body}<!-- visual edit -->` }))
        }
      >
        Visual edit
      </button>
      {disabled && onEditDraft ? (
        <button type="button" onClick={onEditDraft}>
          Edit the draft
        </button>
      ) : null}
    </div>
  ),
}));

jest.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label="code"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock("./imageAssetsPanel", () => ({
  __esModule: true,
  default: () => null,
}));

/* --------------------------- fixtures ----------------------------- */

const MJML =
  '<mjml><mj-body><mj-section><mj-column><mj-text>Read about tamarind.</mj-text><mj-text><a href="{% unsubscribe_url %}">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>';
const HTML =
  '<!DOCTYPE html><html><body><p>About us.</p><a href="{% unsubscribe_url %}">Unsubscribe</a></body></html>';

const base = {
  type: ChannelType.Email,
  emailContentsType: EmailContentsType.Code,
  from: "hello@tryamie.com",
  subject: "Warming email 11",
} as const;

const visual = (editor: "grapesjs-mjml" | "grapesjs-html", body: string) => ({
  ...base,
  body,
  visualDesign: {
    version: 1 as const,
    editor,
    project: { pages: [] },
    mjml: body,
  },
});

interface Case {
  name: string;
  definition: MessageTemplateResource["definition"];
  draft?: MessageTemplateResource["draft"];
}

const CASES: Case[] = [
  {
    name: "(a) published visual template, no draft",
    definition: visual("grapesjs-mjml", MJML),
  },
  {
    name: "(b) published visual template with a draft",
    definition: visual("grapesjs-mjml", MJML),
    draft: { ...visual("grapesjs-mjml", MJML), subject: "Draft subject" },
  },
  {
    name: "(c) old imported code template",
    definition: { ...base, body: HTML },
  },
  {
    name: "(d) new visual MJML template",
    definition: visual("grapesjs-mjml", MJML),
  },
  {
    name: "(e) new HTML visual template",
    definition: visual("grapesjs-html", HTML),
  },
];

/* ---------------------------- harness ----------------------------- */

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof initializeStore>;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
  });
}

async function openPage(c: Case, { viewDraft }: { viewDraft: boolean }) {
  template = {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "workspace-1",
    name: "Warming Email 11",
    type: ChannelType.Email,
    definition: c.definition,
    draft: c.draft,
    updatedAt: Date.now(),
  };
  puts.length = 0;
  const preloaded: Record<string, unknown> = {
    apiBase: "http://api.test",
    workspace: {
      type: CompletionStatus.Successful,
      value: { id: "workspace-1", name: "Amie" },
    },
    // what the journey editor leaves behind after a published journey
    viewDraft,
  };
  store = initializeStore(preloaded);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <StoreProvider createStore={() => store}>
          <EmailEditor templateId={template.id} canvasLayout />
        </StoreProvider>
      </QueryClientProvider>,
    );
  });
  await flush();
}

function buttonByText(text: string | RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    typeof text === "string"
      ? b.textContent?.trim() === text
      : text.test(b.textContent ?? ""),
  );
}

async function clickButton(text: string | RegExp) {
  const b = buttonByText(text);
  if (!b) throw new Error(`no button ${String(text)}`);
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

function visualStub() {
  return container.querySelector<HTMLElement>('[data-testid="visual-stub"]');
}

function draftSwitchLabel(): string | null {
  const labels = Array.from(container.querySelectorAll("label")).map(
    (l) => l.textContent ?? "",
  );
  return labels.find((l) => /Editing draft|Viewing published/.test(l)) ?? null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/* ----------------------------- tests ------------------------------ */

describe("email template page: every template opens editable", () => {
  describe.each([
    ["coming straight to the template", true],
    ["after a published journey (viewDraft left false)", false],
  ])("%s", (_how, viewDraft) => {
    it.each(CASES.map((c) => [c.name, c] as const))(
      "%s: the visual editor is editable, edits save to the draft, the switch shows the draft",
      async (_name, c) => {
        await openPage(c, { viewDraft });
        expect(store.getState().viewDraft).toBe(true);
        await clickButton("Visual");
        const stub = visualStub();
        expect(stub?.dataset.disabled).toBe("false");
        expect(container.textContent).not.toContain(
          "Viewing the published version",
        );
        expect(buttonByText(/Edit draft/)).toBeUndefined();

        await clickButton("Visual edit");
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 900); // the page's save debounce
          });
        });
        const saved = puts.some(
          (p) =>
            typeof p.draft === "object" &&
            p.draft !== null &&
            JSON.stringify(p.draft).includes("visual edit"),
        );
        expect(saved).toBe(true);
        // still editable after the draft was created
        expect(visualStub()?.dataset.disabled).toBe("false");

        await clickButton("Settings");
        expect(draftSwitchLabel()).toBe("Editing draft");
      },
    );
  });

  it("(c) old imported code template: the visual editor and the Code tab are editable", async () => {
    const c = CASES[2];
    if (!c) throw new Error("no case");
    await openPage(c, { viewDraft: false });
    await clickButton("Code");
    const code = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="code"]',
    );
    expect(code?.readOnly).toBe(false);
  });

  it("viewing the published version of a template with a draft is read-only, with a visible way back to the draft", async () => {
    const c = CASES[1];
    if (!c) throw new Error("no case");
    await openPage(c, { viewDraft: true });
    await clickButton("Settings");
    const toggle = Array.from(container.querySelectorAll("label"))
      .find((l) => (l.textContent ?? "").includes("Editing draft"))
      ?.querySelector("input");
    if (!toggle) throw new Error("no draft switch");
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(store.getState().viewDraft).toBe(false);
    await clickButton("Visual");
    expect(visualStub()?.dataset.disabled).toBe("true");
    // in the canvas and in the page header, not only in Settings
    expect(buttonByText("Edit the draft")).toBeDefined();
    expect(buttonByText(/Viewing published · Edit draft/)).toBeDefined();
    await clickButton("Edit the draft");
    expect(store.getState().viewDraft).toBe(true);
    expect(visualStub()?.dataset.disabled).toBe("false");
  });

  it("viewing published with no draft: the first edit creates the draft and the page stays editable", async () => {
    const c = CASES[0];
    if (!c) throw new Error("no case");
    await openPage(c, { viewDraft: true });
    await clickButton("Settings");
    const toggle = Array.from(container.querySelectorAll("label"))
      .find((l) => (l.textContent ?? "").includes("Editing draft"))
      ?.querySelector("input");
    if (!toggle) throw new Error("no draft switch");
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await clickButton("Visual");
    // no draft: the published version is what gets edited
    expect(visualStub()?.dataset.disabled).toBe("false");
    await clickButton("Visual edit");
    expect(store.getState().viewDraft).toBe(true);
    expect(visualStub()?.dataset.disabled).toBe("false");
  });
});
