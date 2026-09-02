/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

import {
  AuthContext,
  AuthModeTypeEnum,
  useAuthHeaders,
} from "./authModeProvider";

describe("useAuthHeaders", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("returns the same header object across rerenders in base mode", () => {
    const seen: Record<string, string>[] = [];
    let bump: () => void = () => {};

    function Probe() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      seen.push(useAuthHeaders());
      return null;
    }

    act(() => {
      root.render(
        <AuthContext.Provider value={{ type: AuthModeTypeEnum.Base }}>
          <Probe />
        </AuthContext.Provider>,
      );
    });
    act(() => bump());
    act(() => bump());

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect(seen[0]).toEqual({});
  });

  it("returns a stable Authorization header keyed by token in embedded mode", () => {
    const seen: Record<string, string>[] = [];
    let bump: () => void = () => {};
    function Probe() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      seen.push(useAuthHeaders());
      return null;
    }
    act(() => {
      root.render(
        <AuthContext.Provider
          value={{ type: AuthModeTypeEnum.Embedded, token: "abc" } as never}
        >
          <Probe />
        </AuthContext.Provider>,
      );
    });
    act(() => bump());
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]).toEqual({ Authorization: "Bearer abc" });
  });
});
