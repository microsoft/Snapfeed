// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const storybookUtilsMocks = vi.hoisted(() => ({
  configureFeedbackStory: vi.fn(),
  openFeedbackForFixture: vi.fn(),
  openAnnotationStory: vi.fn().mockResolvedValue(undefined),
}));

const feedbackControllerMocks = vi.hoisted(() => ({
  createFeedbackController: vi.fn(() => ({
    getSnapshot: () => ({
      x: 0,
      y: 0,
      text: "",
      category: "bug",
      includeScreenshot: true,
      includeContext: true,
      screenshotState: "ready",
      submitState: { kind: "idle" },
      breadcrumb: "stories › card",
      targetLabel: "Story target",
    }),
    subscribe: vi.fn(() => () => {}),
    setText: vi.fn(),
    setCategory: vi.fn(),
    setIncludeScreenshot: vi.fn(),
    setIncludeContext: vi.fn(),
    getPayloadPreview: () => ({ event_type: "feedback" }),
    getScreenshot: () => null,
    annotate: vi.fn().mockResolvedValue(false),
    submit: vi.fn().mockResolvedValue({ kind: "idle" }),
    dispose: vi.fn(),
  })),
}));

const indexMocks = vi.hoisted(() => ({
  initSnapfeed: vi.fn(() => () => {}),
}));

vi.mock("../feedback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../feedback.js")>();
  return {
    ...actual,
    createFeedbackController: feedbackControllerMocks.createFeedbackController,
  };
});

vi.mock("../index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index.js")>();
  return {
    ...actual,
    initSnapfeed: indexMocks.initSnapfeed,
  };
});

vi.mock("./storybook-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./storybook-utils.js")>(
    "./storybook-utils.js",
  );

  return {
    ...actual,
    configureFeedbackStory: storybookUtilsMocks.configureFeedbackStory,
    openFeedbackForFixture: storybookUtilsMocks.openFeedbackForFixture,
    openAnnotationStory: storybookUtilsMocks.openAnnotationStory,
  };
});

import * as annotationStories from "./annotation.stories.js";
import * as feedbackStories from "./feedback.stories.js";

type StoryModule = Record<string, unknown>;

function getStoryEntries(
  module: StoryModule,
): Array<[string, { render: () => HTMLElement }]> {
  return Object.entries(module).filter(
    ([, value]): value is { render: () => HTMLElement } => {
      return (
        typeof value === "object" &&
        value !== null &&
        "render" in value &&
        typeof value.render === "function"
      );
    },
  );
}

function flushAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("Storybook stories", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    storybookUtilsMocks.configureFeedbackStory.mockClear();
    storybookUtilsMocks.openFeedbackForFixture.mockClear();
    storybookUtilsMocks.openAnnotationStory.mockClear();
    feedbackControllerMocks.createFeedbackController.mockClear();
    indexMocks.initSnapfeed.mockClear();
  });

  for (const [storyName, story] of getStoryEntries(feedbackStories)) {
    it(`renders feedback story ${storyName} without errors`, async () => {
      const root = story.render();

      document.body.appendChild(root);
      await flushAnimationFrame();

      expect(root.querySelector("h1")?.textContent).toMatch(
        /feedback overlay/i,
      );
      expect(root.querySelector("#feedback-target")).toBeTruthy();
      if (storyName === "CustomUi") {
        expect(
          storybookUtilsMocks.configureFeedbackStory,
        ).toHaveBeenCalledTimes(1);
        expect(
          storybookUtilsMocks.openFeedbackForFixture,
        ).not.toHaveBeenCalled();
        expect(
          feedbackControllerMocks.createFeedbackController,
        ).toHaveBeenCalledTimes(1);
        expect(indexMocks.initSnapfeed).not.toHaveBeenCalled();
      } else if (storyName === "CustomUiViaInit") {
        expect(
          storybookUtilsMocks.configureFeedbackStory,
        ).not.toHaveBeenCalled();
        expect(
          storybookUtilsMocks.openFeedbackForFixture,
        ).not.toHaveBeenCalled();
        expect(
          feedbackControllerMocks.createFeedbackController,
        ).not.toHaveBeenCalled();
        expect(indexMocks.initSnapfeed).toHaveBeenCalledTimes(1);
      } else {
        expect(
          storybookUtilsMocks.configureFeedbackStory,
        ).toHaveBeenCalledTimes(1);
        expect(
          storybookUtilsMocks.openFeedbackForFixture,
        ).toHaveBeenCalledTimes(1);
        expect(
          feedbackControllerMocks.createFeedbackController,
        ).not.toHaveBeenCalled();
        expect(indexMocks.initSnapfeed).not.toHaveBeenCalled();
      }
      expect(storybookUtilsMocks.openAnnotationStory).not.toHaveBeenCalled();
    });
  }

  for (const [storyName, story] of getStoryEntries(annotationStories)) {
    it(`renders annotation story ${storyName} without errors`, async () => {
      const root = story.render();

      document.body.appendChild(root);
      await flushAnimationFrame();

      expect(root.querySelector("h1")?.textContent).toMatch(
        /annotation canvas/i,
      );
      expect(root.querySelector("#annotation-target")).toBeTruthy();
      expect(storybookUtilsMocks.openAnnotationStory).toHaveBeenCalledTimes(1);
      expect(storybookUtilsMocks.configureFeedbackStory).not.toHaveBeenCalled();
      expect(storybookUtilsMocks.openFeedbackForFixture).not.toHaveBeenCalled();
    });
  }
});
