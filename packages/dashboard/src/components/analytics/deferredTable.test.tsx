/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import DeferredTable from "./deferredTable";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
it("mounts table hooks only when near the viewport, and disconnects", () => {
  let intersect!: IntersectionObserverCallback;
  const disconnect = jest.fn();
  const observe = jest.fn();
  const original = globalThis.IntersectionObserver;
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: jest.fn((callback: IntersectionObserverCallback) => {
      intersect = callback;
      return { observe, disconnect };
    }),
  });
  const table = jest.fn(() => <div>Rows</div>);
  const Table = table;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <DeferredTable>
          <Table />
        </DeferredTable>,
      ),
    );
    expect(table).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(container.firstChild);
    const observer: IntersectionObserver = {
      root: null,
      rootMargin: "200px",
      thresholds: [],
      observe,
      disconnect,
      unobserve: jest.fn(),
      takeRecords: () => [],
    };
    const entry = {
      time: 0,
      target: container,
      rootBounds: null,
      intersectionRatio: 0,
      boundingClientRect: container.getBoundingClientRect(),
      intersectionRect: container.getBoundingClientRect(),
    };
    act(() => intersect([{ ...entry, isIntersecting: false }], observer));
    expect(table).not.toHaveBeenCalled();
    act(() => intersect([{ ...entry, isIntersecting: true }], observer));
    expect(container.textContent).toBe("Rows");
    expect(disconnect).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    globalThis.IntersectionObserver = original;
  }
});
it("provides a manual load button", () => {
  const original = globalThis.IntersectionObserver;
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
    })),
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<DeferredTable>Rows</DeferredTable>));
    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toBe("Rows");
  } finally {
    act(() => root.unmount());
    globalThis.IntersectionObserver = original;
  }
});
