import { expect, test, type Page } from "@playwright/test";

type StoredRow = {
  id: number;
  session_id?: string;
  seq?: number;
  ts?: string;
  event_type: string;
  page?: string | null;
  target: string | null;
  detail_json: string | null;
  screenshot: string | null;
};

const apiBaseUrl = `http://127.0.0.1:${process.env.SNAPFEED_API_PORT ?? "8420"}`;

async function fetchEvents(
  sessionId: string,
  eventType?: string,
): Promise<StoredRow[]> {
  const params = new URLSearchParams({ session_id: sessionId, limit: "200" });
  if (eventType) {
    params.set("event_type", eventType);
  }

  const response = await fetch(
    `${apiBaseUrl}/api/telemetry/events?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Unable to fetch telemetry events: ${response.status}`);
  }

  return (await response.json()) as StoredRow[];
}

async function getEventCount(
  sessionId: string,
  eventType?: string,
): Promise<number> {
  const events = await fetchEvents(sessionId, eventType);
  return events.length;
}

async function readLatestEvent(
  sessionId: string,
  eventType: string,
): Promise<StoredRow | undefined> {
  const events = await fetchEvents(sessionId, eventType);
  return events[0];
}

async function fetchScreenshot(eventId: number): Promise<ArrayBuffer> {
  const response = await fetch(
    `${apiBaseUrl}/api/telemetry/events/${eventId}/screenshot`,
  );
  if (!response.ok) {
    throw new Error(`Unable to fetch telemetry screenshot: ${response.status}`);
  }

  return response.arrayBuffer();
}

async function getSessionId(page: Page): Promise<string> {
  const sessionId = await page.getByTestId("session-id").textContent();
  if (!sessionId || sessionId === "pending") {
    throw new Error("Snapfeed session ID was not available in the demo app");
  }
  return sessionId;
}

async function flushQueue(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const snapfeed = (
      window as Window & {
        __snapfeed?: { flush?: () => Promise<boolean> };
      }
    ).__snapfeed;
    await snapfeed?.flush?.();
  });
}

async function openFeedbackDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="feedback-target"]');
    if (!target) {
      throw new Error("Unable to find the feedback target element");
    }

    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  });
}

test("captures startup, click, and navigation telemetry", async ({ page }) => {
  await page.goto("/");
  const sessionId = await getSessionId(page);

  await page.getByTestId("hero-click-target").click();
  await page.getByRole("button", { name: "Network Lab" }).click();
  await page.getByRole("button", { name: "Failure Lab" }).click();
  await flushQueue(page);

  await expect
    .poll(() => getEventCount(sessionId, "session_start"))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => getEventCount(sessionId, "click"))
    .toBeGreaterThanOrEqual(3);
  await expect
    .poll(() => getEventCount(sessionId, "navigation"))
    .toBeGreaterThanOrEqual(2);
});

test("captures api, network, and runtime errors", async ({ page }) => {
  await page.goto("/network");
  const sessionId = await getSessionId(page);

  await page.getByTestId("api-failure").getByRole("button").click();
  await page.getByTestId("network-failure").getByRole("button").click();
  await page.getByRole("button", { name: "Failure Lab" }).click();
  await page.getByTestId("throw-window-error").getByRole("button").click();
  await page.getByTestId("reject-promise").getByRole("button").click();

  await flushQueue(page);

  await expect
    .poll(() => getEventCount(sessionId, "api_error"))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => getEventCount(sessionId, "network_error"))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => getEventCount(sessionId, "error"))
    .toBeGreaterThanOrEqual(2);
});

test("submits feedback with screenshot and context", async ({ page }) => {
  await page.goto("/feedback");
  const sessionId = await getSessionId(page);

  await openFeedbackDialog(page);
  await expect(page.locator("#__sf_text")).toBeVisible();

  await page
    .locator("#__sf_text")
    .fill("Feedback route stores screenshot and visible form state.");
  await page.locator("#__sf_details_toggle").click();
  await page.locator("#__sf_send").click();
  await expect(page.locator("#__sf_status")).toContainText("Feedback sent");

  await flushQueue(page);

  await expect
    .poll(() => getEventCount(sessionId, "feedback"))
    .toBeGreaterThanOrEqual(1);

  const feedbackEvent = await readLatestEvent(sessionId, "feedback");
  expect(feedbackEvent).toBeDefined();
  expect(feedbackEvent?.target).toContain("Feedback route stores screenshot");
  expect(feedbackEvent?.id).toBeDefined();

  const screenshotBytes = await fetchScreenshot(feedbackEvent?.id ?? 0);
  expect(screenshotBytes.byteLength).toBeGreaterThan(0);

  const detail = JSON.parse(feedbackEvent?.detail_json ?? "{}") as Record<
    string,
    unknown
  >;
  expect(detail.category).toBe("bug");
  expect(detail["data-feedback-context"]).toBe("review-board");
  expect(detail.component).toBe("FeedbackReviewCard");
  expect(detail.form_state).toMatchObject({
    Reporter: "QA Operator",
    Priority: "high",
    "Attach release notes": "true",
  });
});
