// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPlugins: vi.fn(),
  enrichElement: vi.fn(() => null),
  flush: vi.fn().mockResolvedValue(true),
  getPluginNames: vi.fn(() => []),
  getQueue: vi.fn(() => []),
  getSessionId: vi.fn(() => "session-123"),
  handleCtrlClick: vi.fn(),
  initFeedback: vi.fn(),
  push: vi.fn(),
  registerPlugin: vi.fn(),
  sanitize: vi.fn((value: unknown) => value),
  sanitizeDetail: vi.fn((detail: Record<string, unknown>) => detail),
  startCapturing: vi.fn(),
  startFlushing: vi.fn(),
  stopCapturing: vi.fn(),
  stopFlushing: vi.fn(),
}));

vi.mock("./console-capture.js", () => ({
  getConsoleErrors: vi.fn(() => []),
  startCapturing: mocks.startCapturing,
  stopCapturing: mocks.stopCapturing,
}));

vi.mock("./feedback.js", () => ({
  gatherContext: vi.fn(),
  handleCtrlClick: mocks.handleCtrlClick,
  initFeedback: mocks.initFeedback,
}));

vi.mock("./plugins.js", () => ({
  clearPlugins: mocks.clearPlugins,
  enrichElement: mocks.enrichElement,
  getPluginNames: mocks.getPluginNames,
  registerPlugin: mocks.registerPlugin,
  unregisterPlugin: vi.fn(),
}));

vi.mock("./queue.js", () => ({
  flush: mocks.flush,
  getQueue: mocks.getQueue,
  getSessionId: mocks.getSessionId,
  push: mocks.push,
  startFlushing: mocks.startFlushing,
  stopFlushing: mocks.stopFlushing,
}));

vi.mock("./sanitize.js", () => ({
  sanitize: mocks.sanitize,
  sanitizeDetail: mocks.sanitizeDetail,
}));

import { initSnapfeed } from "./index.js";

describe("initSnapfeed click handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    mocks.clearPlugins.mockClear();
    mocks.enrichElement.mockReturnValue(null);
    mocks.flush.mockResolvedValue(true);
    mocks.getPluginNames.mockReturnValue([]);
    mocks.handleCtrlClick.mockClear();
    mocks.initFeedback.mockClear();
    mocks.push.mockClear();
    mocks.registerPlugin.mockClear();
    mocks.sanitize.mockImplementation((value: unknown) => value);
    mocks.sanitizeDetail.mockImplementation(
      (detail: Record<string, unknown>) => detail,
    );
    mocks.startCapturing.mockClear();
    mocks.startFlushing.mockClear();
    mocks.stopCapturing.mockClear();
    mocks.stopFlushing.mockClear();
  });

  it("registers two click listeners when feedback and rage tracking are enabled", () => {
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");

    const teardown = initSnapfeed({
      captureConsoleErrors: false,
      feedback: { enabled: true },
      networkLog: { enabled: false },
      sessionReplay: { enabled: false },
      trackApiErrors: false,
      trackErrors: false,
      trackNavigation: false,
    });

    const clickRegistrations = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === "click",
    );
    expect(clickRegistrations).toHaveLength(2);

    teardown();
  });

  it("routes ctrl-clicks to feedback without recording a normal click event", () => {
    const teardown = initSnapfeed({
      captureConsoleErrors: false,
      feedback: { enabled: true },
      networkLog: { enabled: false },
      sessionReplay: { enabled: false },
      trackApiErrors: false,
      trackErrors: false,
      trackNavigation: false,
    });
    const button = document.createElement("button");
    document.body.appendChild(button);
    mocks.push.mockClear();

    button.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    );

    expect(mocks.handleCtrlClick).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();

    teardown();
  });

  it("records clicks and rage-clicks through the same tracked click pipeline", () => {
    const teardown = initSnapfeed({
      captureConsoleErrors: false,
      feedback: { enabled: false },
      networkLog: { enabled: false },
      sessionReplay: { enabled: false },
      trackApiErrors: false,
      trackErrors: false,
      trackNavigation: false,
    });
    const button = document.createElement("button");
    button.textContent = "Track me";
    document.body.appendChild(button);
    mocks.push.mockClear();

    for (let index = 0; index < 3; index++) {
      button.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 24 + index,
          clientY: 48 + index,
        }),
      );
    }

    const eventTypes = mocks.push.mock.calls.map((call) => call[0]);
    expect(
      eventTypes.filter((eventType) => eventType === "click"),
    ).toHaveLength(3);
    expect(
      eventTypes.filter((eventType) => eventType === "rage_click"),
    ).toHaveLength(1);

    teardown();
  });
});
