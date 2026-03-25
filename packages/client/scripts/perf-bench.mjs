/**
 * Lightweight benchmark harness for comparing client hot paths before and after local changes.
 */

import { JSDOM } from "jsdom";
import {
  createRageDetector,
  gatherContext,
  initSnapfeed,
} from "../dist/index.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.com/app?tab=1",
  });
  const { window } = dom;

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    history: window.history,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLImageElement: window.HTMLImageElement,
    Element: window.Element,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    requestAnimationFrame:
      window.requestAnimationFrame?.bind(window) ??
      ((callback) => window.setTimeout(callback, 16)),
    cancelAnimationFrame:
      window.cancelAnimationFrame?.bind(window) ??
      window.clearTimeout.bind(window),
  };

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  return dom;
}

function buildFixture() {
  const form = document.createElement("div");
  document.body.appendChild(form);

  for (let index = 0; index < 300; index++) {
    const input = document.createElement("input");
    input.name = `field_${index}`;
    input.value = `value_${index}`;
    Object.defineProperty(input, "offsetParent", {
      configurable: true,
      value: form,
    });
    form.appendChild(input);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Submit order";
  button.setAttribute("aria-label", "Submit order button");
  button.setAttribute("data-feedback-context", "checkout");
  form.appendChild(button);

  return { button };
}

function benchmarkRageDetector() {
  const detector = createRageDetector({ onRageClick() {} });
  const start = performance.now();

  for (let index = 0; index < 100000; index++) {
    detector.recordClick(`button-${index % 5}`, index % 300, index % 200);
  }

  return performance.now() - start;
}

function benchmarkGatherContext(button) {
  const start = performance.now();

  for (let index = 0; index < 200; index++) {
    gatherContext(button);
  }

  return performance.now() - start;
}

function benchmarkClickPipeline(button) {
  const teardown = initSnapfeed({
    endpoint: "/api/test-feedback",
    trackNavigation: false,
    trackErrors: false,
    trackApiErrors: false,
    captureConsoleErrors: false,
    feedback: { enabled: false },
    networkLog: { enabled: false },
    sessionReplay: { enabled: false },
    rageClick: { enabled: true, threshold: 3, windowMs: 1000 },
  });

  const originalLog = console.log;
  console.log = () => {};

  const start = performance.now();
  for (let index = 0; index < 5000; index++) {
    button.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: index % 400,
        clientY: index % 300,
      }),
    );
  }
  const duration = performance.now() - start;

  console.log = originalLog;
  teardown();
  return duration;
}

installDom();
const { button } = buildFixture();

const results = {
  clickPipelineMs: Number(benchmarkClickPipeline(button).toFixed(2)),
  rageDetectorMs: Number(benchmarkRageDetector().toFixed(2)),
  gatherContextMs: Number(benchmarkGatherContext(button).toFixed(2)),
};

console.log(JSON.stringify(results, null, 2));
