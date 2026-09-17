/** @jest-environment jsdom */
import { ChannelType, EmailContentsType } from "isomorphic-lib/src/types";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import CodeEmailBodyEditor from "./codeEmailBodyEditor";

jest.mock("./imageAssetsPanel", () => ({
  __esModule: true,
  default: () => null,
}));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it("fills the pane, shows line numbers and folding, and opens search with Ctrl+F", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <CodeEmailBodyEditor
          draft={{
            type: ChannelType.Email,
            emailContentsType: EmailContentsType.Code,
            from: "hello@example.com",
            subject: "Test",
            body: `<html>\n<body>\n${"<p>Long HTML</p>\n".repeat(100)}</body>\n</html>`,
          }}
          setDraft={() => {}}
          disabled={false}
          inDraftView
        />,
      ),
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    const scroller = container.querySelector<HTMLElement>(".cm-scroller");
    expect(editor).not.toBeNull();
    expect(scroller).not.toBeNull();
    if (!editor || !scroller) throw new Error("CodeMirror did not mount");
    expect(getComputedStyle(editor).height).toBe("100%");
    expect(getComputedStyle(scroller).overflowY).toBe("scroll");
    expect(container.querySelector(".cm-gutters")).not.toBeNull();
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(container.querySelector(".cm-activeLine")).not.toBeNull();
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content missing");
    act(() =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(
      container.querySelector(".cm-search input[name=search]"),
    ).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
