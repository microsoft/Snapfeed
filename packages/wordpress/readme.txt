=== Snapfeed ===
Contributors: microsoft
Tags: feedback, screenshots, telemetry, bug-reporting, ai-agents
Requires at least: 5.6
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Close the loop between humans and AI agents. Capture UI feedback — screenshots, clicks, errors, context — and feed it back to the agent that built the interface.

== Description ==

Snapfeed captures UI feedback from your WordPress site and stores it in your WordPress database. Users can Cmd+Click (or Ctrl+Click) anywhere on your site to submit annotated screenshots with categorized feedback (Bug, Idea, Question, Praise).

**Features:**

* 📸 Screenshot capture with annotation support
* 🖱 Click, navigation, and error tracking
* 😤 Rage click detection
* 🌐 Network request logging
* 🔄 Lightweight session replay
* 💬 Categorized feedback (Bug, Idea, Question, Praise)
* 📊 Admin dashboard for viewing sessions and events
* 🔐 Anti-spam: Cloudflare Turnstile + rate limiting
* 🤖 REST API for AI agent access via Application Passwords

**For AI Agents:**

External agents can query feedback via the WordPress REST API using Application Passwords:

    curl -u username:app_password https://yoursite.com/wp-json/snapfeed/v1/events?event_type=feedback

== Installation ==

1. Upload the `snapfeed` folder to `/wp-content/plugins/`
2. Activate the plugin through the 'Plugins' menu
3. Go to Settings → Snapfeed to configure
4. That's it! Feedback capture starts immediately.

**For AI agent access:**

1. Go to Users → Profile → Application Passwords
2. Create a new Application Password
3. Give the username + password to your agent

== Frequently Asked Questions ==

= Does this require an external server? =

No. Snapfeed stores everything in your WordPress database. No external services required.

= How do I prevent spam? =

Enable Cloudflare Turnstile in Settings → Snapfeed. It's free and invisible to users. Rate limiting is enabled by default.

= Can AI agents read the feedback? =

Yes. The REST API at `/wp-json/snapfeed/v1/` is accessible via WordPress Application Passwords (HTTP Basic Auth).

== Changelog ==

= 0.1.0 =
* Initial release
* Screenshot feedback with annotations
* Click, navigation, error tracking
* Rage click detection
* Network request logging
* Session replay
* Admin dashboard
* Cloudflare Turnstile integration
* REST API for agent access
