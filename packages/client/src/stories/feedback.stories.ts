import type { Meta, StoryObj } from "@storybook/html";
import { resolveConfig } from "../types.js";
import {
  getAnnotatedFeedbackStoryScreenshot,
  configureFeedbackStory,
  createFixtureCard,
  getFeedbackStoryScreenshot,
  openFeedbackForFixture,
  renderStoryShell,
} from "./storybook-utils.js";

const meta = {
  title: "Snapfeed/Feedback Overlay",
} satisfies Meta;

export default meta;

type Story = StoryObj;

interface FeedbackStoryState {
  initialMessage?: string;
  initialCategory?: "bug" | "idea" | "question" | "praise" | "other";
  initialHasAnnotatedScreenshot?: boolean;
  initialBaseScreenshotPromise?: Promise<string | null>;
  initialExpanded?: boolean;
  screenshotPromise?: Promise<string | null>;
  prepareTarget?: (target: HTMLElement) => void;
}

function renderFeedbackPreset(
  preset: "modern" | "windows90s" | "terminal",
  title: string,
  subtitle: string,
  state: FeedbackStoryState = {},
): HTMLDivElement {
  let hasAutoOpened = false;
  const root = renderStoryShell(title, subtitle);
  const fixture = createFixtureCard();
  root.appendChild(fixture);

  configureFeedbackStory(
    preset,
    resolveConfig({
      feedback: {
        enabled: true,
        annotations: true,
        screenshotQuality: 0.8,
      },
      captureConsoleErrors: false,
      trackApiErrors: false,
      trackClicks: false,
      trackErrors: false,
      trackNavigation: false,
      user: {
        name: "Storybook Preview",
        email: "preview@snapfeed.dev",
      },
    }),
  );

  const target = fixture.querySelector("#feedback-target");
  if (target) {
    state.prepareTarget?.(target as HTMLElement);
    target.addEventListener("click", () =>
      openFeedbackForFixture(target, {
        initialCategory: state.initialCategory,
        initialExpanded: state.initialExpanded,
        initialHasAnnotatedScreenshot: state.initialHasAnnotatedScreenshot,
        initialBaseScreenshotPromise: state.initialBaseScreenshotPromise,
        initialMessage: state.initialMessage,
        screenshotPromise: state.screenshotPromise,
      }),
    );

    requestAnimationFrame(() => {
      if (hasAutoOpened) {
        return;
      }
      hasAutoOpened = true;
      openFeedbackForFixture(target, {
        initialCategory: state.initialCategory,
        initialExpanded: state.initialExpanded,
        initialHasAnnotatedScreenshot: state.initialHasAnnotatedScreenshot,
        initialBaseScreenshotPromise: state.initialBaseScreenshotPromise,
        initialMessage: state.initialMessage,
        screenshotPromise: state.screenshotPromise,
      });
    });
  }

  return root;
}

export const Modern: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Modern feedback overlay",
      "A tighter default treatment with stronger hierarchy, visible screenshot state, and a single obvious primary action.",
      {
        initialMessage:
          "The toolbar feels cramped when I try to annotate the screenshot.",
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};

export const EmptyDraft: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay empty draft state",
      "The send action should stay visibly disabled while the overlay still communicates that the screenshot is being prepared in the background.",
      {
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};

export const ScreenshotUnavailable: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay screenshot unavailable state",
      "The overlay should still feel trustworthy and actionable when screenshot capture is not available.",
      {
        initialMessage:
          "The close affordance is hard to spot on smaller viewports.",
        screenshotPromise: Promise.resolve(null),
      },
    ),
};

export const ScreenshotCapturing: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay screenshot capturing state",
      "Use this to inspect the pending-capture state and make sure the overlay still reads clearly before the screenshot finishes.",
      {
        initialMessage:
          "I want to verify that the pending screenshot state is understandable.",
        screenshotPromise: new Promise<string | null>(() => {}),
      },
    ),
};

export const QuestionPrompt: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay question prompt state",
      "This story makes it easier to inspect the category-guided prompt without typing into the field first.",
      {
        initialCategory: "question",
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};

export const IdeaPrompt: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay idea prompt state",
      "Use this to compare the category-specific guidance and prompt language for improvement-oriented feedback.",
      {
        initialCategory: "idea",
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};

export const AnnotatedScreenshot: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay annotated screenshot state",
      "This story simulates a screenshot that has already been marked up so you can inspect the end-to-end annotated state in the overlay.",
      {
        initialMessage:
          "The existing annotation reads clearly, and I want to confirm the overlay state stays understandable.",
        initialBaseScreenshotPromise: getFeedbackStoryScreenshot(),
        screenshotPromise: getAnnotatedFeedbackStoryScreenshot(),
        initialHasAnnotatedScreenshot: true,
      },
    ),
};

export const ExpandedDetails: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay expanded details state",
      "Use this to inspect the full metadata-heavy mode while keeping the new quick view as the default interaction.",
      {
        initialExpanded: true,
        initialMessage:
          "I want to inspect the richer context view without having to toggle it open first.",
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};

export const LongContext: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Feedback overlay long context state",
      "This state stresses the metadata row so you can judge whether the overlay still scans cleanly when the captured element carries more context than usual.",
      {
        initialMessage:
          "There is a lot of useful context here, but the target still needs to read clearly at a glance.",
        screenshotPromise: getFeedbackStoryScreenshot(),
        prepareTarget: (target) => {
          target.setAttribute(
            "data-feedback-context",
            "settings/billing/team-members/invite-flow/final-confirmation",
          );
          target.setAttribute("data-index", "128");
          target.setAttribute(
            "aria-label",
            "Invite teammate confirmation panel with billing gate and role-based access summary",
          );
        },
      },
    ),
};

export const Windows90s: Story = {
  render: () =>
    renderFeedbackPreset(
      "windows90s",
      "Windows 90s feedback overlay",
      "Classic desktop chrome with hard edges, system-font density, and high-contrast framing so you can judge whether the interaction benefits from a more literal operating-system feel.",
      {
        initialMessage:
          "The retro preset makes the hierarchy feel sharper than the default here.",
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};

export const Terminal: Story = {
  render: () =>
    renderFeedbackPreset(
      "terminal",
      "Terminal feedback overlay",
      "A utilitarian preset that shows how the same interaction reads with monospaced typography and flatter chrome.",
      {
        initialMessage:
          "The simpler chrome is nice, but the metadata row still needs to feel intentional.",
        screenshotPromise: getFeedbackStoryScreenshot(),
      },
    ),
};
