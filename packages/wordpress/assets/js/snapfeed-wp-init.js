/**
 * Snapfeed WordPress init wrapper.
 *
 * Reads configuration from SnapfeedWP (injected by wp_localize_script)
 * and initializes Snapfeed with the correct settings.
 */
(function () {
  "use strict";

  if (typeof window.Snapfeed === "undefined" || typeof window.SnapfeedWP === "undefined") {
    return;
  }

  var cfg = window.SnapfeedWP;
  var SF = window.Snapfeed;

  // Build the config object for initSnapfeed()
  var config = {
    endpoint: cfg.endpoint,
    trackClicks: cfg.trackClicks === "1",
    trackNavigation: cfg.trackNavigation === "1",
    trackErrors: cfg.trackErrors === "1",
    trackApiErrors: cfg.trackApiErrors === "1",
    feedback: {
      enabled: cfg.feedbackEnabled === "1",
      screenshotQuality: parseFloat(cfg.screenshotQuality) || 0.6,
    },
  };

  // Add nonce to all requests via a custom fetch wrapper
  var originalEndpoint = cfg.endpoint;
  var wpNonce = cfg.nonce;

  // Monkey-patch the endpoint to include the nonce header
  // The Snapfeed client uses fetch() to POST to the endpoint,
  // so we intercept and add the X-WP-Nonce header
  var origFetch = window.fetch;
  window.fetch = function (url, opts) {
    if (typeof url === "string" && url.indexOf(originalEndpoint) !== -1) {
      opts = opts || {};
      opts.headers = opts.headers || {};
      if (typeof opts.headers.set === "function") {
        opts.headers.set("X-WP-Nonce", wpNonce);
      } else {
        opts.headers["X-WP-Nonce"] = wpNonce;
      }

      // Attach Turnstile token if available
      if (window._snapfeedTurnstileToken) {
        if (typeof opts.headers.set === "function") {
          opts.headers.set("X-Turnstile-Token", window._snapfeedTurnstileToken);
        } else {
          opts.headers["X-Turnstile-Token"] = window._snapfeedTurnstileToken;
        }
        window._snapfeedTurnstileToken = null;
      }
    }
    return origFetch.apply(this, arguments);
  };

  // Initialize Snapfeed
  var teardown = SF.initSnapfeed(config);

  // Register WordPress enrichment plugin
  SF.registerPlugin({
    name: "wordpress",
    enrichElement: function () {
      // Attach WordPress page context to every event
      var body = document.body;
      var result = {};
      if (body.classList.contains("single")) result.wpPostType = "single";
      else if (body.classList.contains("page")) result.wpPostType = "page";
      else if (body.classList.contains("archive")) result.wpPostType = "archive";
      else if (body.classList.contains("home")) result.wpPostType = "home";

      // WordPress adds body classes with post ID
      var classes = body.className.match(/postid-(\d+)/);
      if (classes) result.wpPostId = classes[1];

      // Page template
      var tpl = body.className.match(/page-template-([^\s]+)/);
      if (tpl) result.wpTemplate = tpl[1];

      return Object.keys(result).length > 0 ? result : null;
    },
  });

  // Turnstile: obtain token when feedback dialog opens
  if (cfg.turnstileSiteKey && typeof window.turnstile !== "undefined") {
    // Create a hidden container for Turnstile widget
    var container = document.createElement("div");
    container.id = "snapfeed-turnstile";
    container.style.display = "none";
    document.body.appendChild(container);

    window.turnstile.render("#snapfeed-turnstile", {
      sitekey: cfg.turnstileSiteKey,
      callback: function (token) {
        window._snapfeedTurnstileToken = token;
      },
      "error-callback": function () {
        window._snapfeedTurnstileToken = null;
      },
      "expired-callback": function () {
        // Re-render on expiry
        window.turnstile.reset("#snapfeed-turnstile");
      },
    });
  }

  // Expose teardown for debugging
  window.__snapfeedWPTeardown = teardown;
})();
